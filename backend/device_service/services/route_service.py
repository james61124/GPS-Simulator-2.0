import asyncio
import logging
import math
import os
import threading
import time
from typing import Any, Dict, List, Tuple

import polyline
import requests
from dotenv import load_dotenv
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

from ..api.schemas.location import LatLngModel, RoutePreviewRequest
from ..state import STATE
from .tunnel_service import (
    ensure_tunnel_and_rsd,
    probe_rsd_ipv6,
    rebuild_tunnel_for_current_udid,
)

load_dotenv()

log = logging.getLogger("walksim.device")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
_ROUTE_CACHE: dict[tuple, list[tuple[float, float]]] = {}


def _thread_matches(cur: threading.Thread, target: threading.Thread | None) -> bool:
    return target is not None and cur.ident == target.ident


async def _clear_location_async(host: str, port: int) -> None:
    async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
        with DvtSecureSocketProxyService(sp_rsd) as dvt:
            LocationSimulation(dvt).clear()


def _route_set_status(
    *,
    status: str | None = None,
    progress_index: int | None = None,
    total_points: int | None = None,
    last_ok_location: Tuple[float, float] | None = None,
    error: str | None = None,
) -> None:
    with STATE.device_lock:
        if status is not None:
            STATE.route_status = status
        if progress_index is not None:
            STATE.route_progress_index = progress_index
        if total_points is not None:
            STATE.route_total_points = total_points
        if last_ok_location is not None:
            STATE.route_last_ok_location = last_ok_location
        if error is not None:
            STATE.route_error = error


def get_route_status() -> Dict[str, Any]:
    with STATE.device_lock:
        return {
            "status": STATE.route_status,
            "progress_index": STATE.route_progress_index,
            "total_points": STATE.route_total_points,
            "last_ok_location": (
                {"lat": STATE.route_last_ok_location[0], "lng": STATE.route_last_ok_location[1]}
                if STATE.route_last_ok_location is not None
                else None
            ),
            "error": STATE.route_error,
            "plan": STATE.route_plan,
        }


def _decode_polyline(points_str: str) -> list[tuple[float, float]]:
    return polyline.decode(points_str)


def _get_route_steps_google(
    origin: tuple[float, float],
    dest: tuple[float, float],
    mode: str = "walking",
) -> list[dict]:
    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError("missing GOOGLE_MAPS_API_KEY env")

    url = (
        "https://maps.googleapis.com/maps/api/directions/json"
        f"?origin={origin[0]},{origin[1]}"
        f"&destination={dest[0]},{dest[1]}"
        f"&mode={mode}"
        f"&departure_time=now"
        f"&key={GOOGLE_MAPS_API_KEY}"
    )

    resp = requests.get(url, timeout=20)
    data = resp.json()

    if data.get("status") != "OK":
        raise RuntimeError(f"google directions err status={data.get('status')} msg={data.get('error_message')}")

    return data["routes"][0]["legs"][0]["steps"]


def _steps_to_route_points(steps: list[dict]) -> list[tuple[float, float]]:
    route_points: list[tuple[float, float]] = []
    for step in steps:
        pts = _decode_polyline(step["polyline"]["points"])
        if not pts:
            continue
        if route_points:
            pts = pts[1:]
        route_points.extend(pts)
    return route_points


def _route_points_between(
    a: tuple[float, float],
    b: tuple[float, float],
    mode: str = "walking",
) -> list[tuple[float, float]]:
    key = (round(a[0], 6), round(a[1], 6), round(b[0], 6), round(b[1], 6), mode)
    hit = _ROUTE_CACHE.get(key)
    if hit is not None and len(hit) >= 2:
        return hit

    steps = _get_route_steps_google(a, b, mode=mode)
    pts = _steps_to_route_points(steps)

    if not pts or len(pts) < 2:
        pts = [a, b]

    _ROUTE_CACHE[key] = pts
    return pts


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _interpolate(a: Tuple[float, float], b: Tuple[float, float], t: float) -> Tuple[float, float]:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _densify_by_time(
    points: List[Tuple[float, float]],
    speed_mps: float,
    interval_s: float,
) -> List[Tuple[float, float]]:
    if not points or len(points) < 2:
        return points or []

    spacing_m = speed_mps * interval_s
    out = [points[0]]
    cur = points[0]
    seg_i = 0

    while seg_i < len(points) - 1:
        nxt = points[seg_i + 1]
        seg_len = _haversine_m(cur[0], cur[1], nxt[0], nxt[1])

        if seg_len < 1e-6:
            seg_i += 1
            cur = nxt
            continue

        if seg_len >= spacing_m:
            t = spacing_m / seg_len
            cur = _interpolate(cur, nxt, t)
            out.append(cur)
        else:
            seg_i += 1
            cur = nxt

    if _haversine_m(out[-1][0], out[-1][1], points[-1][0], points[-1][1]) > 0.5:
        out.append(points[-1])

    return out


def _now_s() -> float:
    return time.monotonic()


def _build_full_route_points(
    pts: list[tuple[float, float]],
    loop: bool,
    mode: str = "walking",
) -> list[tuple[float, float]]:
    if len(pts) < 2:
        return pts

    out: list[tuple[float, float]] = [pts[0]]
    pairs = list(zip(pts, pts[1:]))

    if loop:
        pairs.append((pts[-1], pts[0]))

    for a, b in pairs:
        seg = _route_points_between(a, b, mode=mode)
        if not seg:
            continue
        seg = seg[1:] if out and len(seg) > 1 else seg
        out.extend(seg)

    return out


def stop_route(clear_device: bool = True) -> Dict:
    with STATE.device_lock:
        t = STATE.route_thread
        evt = STATE.route_stop_evt
        udid = STATE.udid
        if t is not None and t.is_alive():
            evt.set()

    if t is not None and t.is_alive():
        try:
            t.join(timeout=5)
        except Exception:
            pass

    with STATE.device_lock:
        if STATE.route_thread is t and (t is None or not t.is_alive()):
            STATE.route_thread = None
            STATE.route_stop_evt = threading.Event()
            if STATE.route_status not in ("failed", "completed"):
                STATE.route_status = "stopped"
            STATE.route_plan = None

    if clear_device and udid is not None:
        try:
            host, port = ensure_tunnel_and_rsd(udid)
            asyncio.run(_clear_location_async(host, port))
        except Exception as e:
            log.warning(f"clear location failed err={e}")

    return {"status": "stopped"}


def simulate_route(
    points: list[dict],
    speed_kmh: float = 30,
    interval_s: float = 0.5,
    pause_s: float = 0.0,
    loop: bool = False,
    from_current: bool = False,
    mode: str = "walking",
) -> dict:
    from .location_service import stop_location

    if from_current:
        with STATE.device_lock:
            last = STATE.last_location
        if last is None:
            raise RuntimeError("from_current=true but no last_location, call update_location first")
        lat, lng = last
        points = [{"lat": lat, "lng": lng}] + points

    if not points or len(points) < 2:
        raise RuntimeError("need at least 2 points")

    stop_route(clear_device=False)
    stop_location(clear_device=False)

    with STATE.device_lock:
        STATE.route_stop_evt = threading.Event()
        STATE.route_plan = {
            "points": points,
            "speed_kmh": speed_kmh,
            "interval_s": interval_s,
            "pause_s": pause_s,
            "loop": loop,
            "from_current": from_current,
            "mode": mode,
        }
        STATE.route_status = "running"
        STATE.route_progress_index = 0
        STATE.route_total_points = 0
        STATE.route_last_ok_location = None
        STATE.route_error = None

        t = threading.Thread(
            target=_route_worker,
            args=(points, speed_kmh, interval_s, pause_s, loop, mode),
            daemon=True,
        )
        STATE.route_thread = t
        t.start()

        return {"status": "running", **STATE.route_plan}


def _route_worker(
    points: List[Dict],
    speed_kmh: float,
    interval_s: float,
    pause_s: float,
    loop: bool,
    mode: str,
) -> None:
    async def _run() -> None:
        with STATE.device_lock:
            udid = STATE.udid
            stop_evt = STATE.route_stop_evt

        if udid is None:
            raise RuntimeError("no connected device")

        raw_pts = [(float(p["lat"]), float(p["lng"])) for p in points]
        full_route = _build_full_route_points(raw_pts, loop=loop, mode=mode)

        speed_mps = float(speed_kmh) * 1000.0 / 3600.0
        dense = _densify_by_time(full_route, speed_mps, float(interval_s))
        if not dense:
            raise RuntimeError("route densify produced empty point list")

        _route_set_status(
            status="running",
            progress_index=0,
            total_points=len(dense),
            error="",
        )

        i = 0
        retry_count = 0
        max_retries = 6
        backoffs = [0.5, 1.0, 2.0, 3.0, 5.0, 8.0]

        while not stop_evt.is_set():
            if i >= len(dense):
                if loop:
                    i = 0
                    _route_set_status(status="running", progress_index=0)
                    continue
                _route_set_status(status="completed", progress_index=len(dense))
                return

            try:
                host, port = ensure_tunnel_and_rsd(udid)

                with STATE.device_lock:
                    proc = STATE.tunnel_proc
                    tunnel_alive = proc is not None and proc.poll() is None

                probe_ok = probe_rsd_ipv6(host, port)
                log.warning(
                    f"route worker connect rsd={host}:{port} "
                    f"tunnel_alive={tunnel_alive} probe_ok={probe_ok} "
                    f"retry={retry_count} index={i}/{len(dense)}"
                )

                if not tunnel_alive:
                    raise RuntimeError("tunnel process is not alive before sending route point")
                if not probe_ok:
                    raise RuntimeError(f"RSD endpoint not reachable before sending route point: {host}:{port}")

                async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
                    with DvtSecureSocketProxyService(sp_rsd) as dvt:
                        sim = LocationSimulation(dvt)

                        while not stop_evt.is_set():
                            if i >= len(dense):
                                break

                            lat, lng = dense[i]

                            try:
                                sim.set(str(lat), str(lng))
                            except OSError as e:
                                with STATE.device_lock:
                                    proc = STATE.tunnel_proc
                                    tunnel_alive = proc is not None and proc.poll() is None
                                probe_ok = probe_rsd_ipv6(host, port)
                                log.exception(
                                    f"route sim.set failed lat={lat} lng={lng} "
                                    f"rsd={host}:{port} tunnel_alive={tunnel_alive} "
                                    f"probe_ok={probe_ok} retry={retry_count} idx={i} err={e}"
                                )
                                raise

                            with STATE.device_lock:
                                STATE.last_location = (lat, lng)
                                STATE.route_progress_index = i + 1
                                STATE.route_last_ok_location = (lat, lng)
                                STATE.route_status = "running"
                                STATE.route_error = None

                            i += 1
                            retry_count = 0

                            if i >= len(dense):
                                break

                            next_tick = _now_s() + float(interval_s)
                            while not stop_evt.is_set():
                                remain = next_tick - _now_s()
                                if remain <= 0:
                                    break
                                await asyncio.sleep(min(0.2, remain))

                        if i >= len(dense) and pause_s and pause_s > 0 and not loop:
                            end_deadline = _now_s() + float(pause_s)
                            while _now_s() < end_deadline and not stop_evt.is_set():
                                await asyncio.sleep(min(0.2, end_deadline - _now_s()))

            except Exception as e:
                if stop_evt.is_set():
                    break

                retry_count += 1
                _route_set_status(status="reconnecting", progress_index=i, error=str(e))
                log.warning(f"route reconnect needed retry={retry_count}/{max_retries} idx={i} err={e}")

                if retry_count > max_retries:
                    _route_set_status(status="failed", progress_index=i, error=f"retry exceeded: {e}")
                    return

                try:
                    rebuild_tunnel_for_current_udid()
                except Exception as rebuild_err:
                    log.warning(f"rebuild tunnel failed retry={retry_count} err={rebuild_err}")
                    _route_set_status(status="reconnecting", progress_index=i, error=str(rebuild_err))

                backoff = backoffs[min(retry_count - 1, len(backoffs) - 1)]
                await asyncio.sleep(backoff)

        _route_set_status(status="stopped", progress_index=i)

    try:
        asyncio.run(_run())
    except Exception as e:
        log.exception(f"route worker failed err={e}")
        _route_set_status(status="failed", error=str(e))
    finally:
        cur = threading.current_thread()
        with STATE.device_lock:
            if _thread_matches(cur, STATE.route_thread):
                STATE.route_thread = None
                STATE.route_stop_evt = threading.Event()
                STATE.route_plan = None


def _path_distance_m(pts: list[tuple[float, float]]) -> float:
    if not pts or len(pts) < 2:
        return 0.0

    total = 0.0
    for (a_lat, a_lng), (b_lat, b_lng) in zip(pts, pts[1:]):
        total += _haversine_m(a_lat, a_lng, b_lat, b_lng)

    return total


def preview_route(req: RoutePreviewRequest) -> dict[str, Any]:
    pts_models = req.points

    if req.from_current:
        with STATE.device_lock:
            last = STATE.last_location
        if last is None:
            raise RuntimeError("from_current=true but no last_location, call update_location first")
        lat, lng = last
        pts_models = [LatLngModel(lat=lat, lng=lng)] + pts_models

    if not pts_models or len(pts_models) < 2:
        raise RuntimeError("need at least 2 points")

    raw_pts: list[tuple[float, float]] = [(float(p.lat), float(p.lng)) for p in pts_models]

    full_route = _build_full_route_points(raw_pts, loop=bool(req.loop), mode=req.mode)
    if not full_route or len(full_route) < 2:
        full_route = raw_pts

    speed_mps = float(req.speed_kmh) * 1000.0 / 3600.0
    dense = _densify_by_time(full_route, speed_mps, float(req.interval_s))
    if not dense or len(dense) < 2:
        dense = full_route

    dist_m = _path_distance_m(full_route)
    eta_s = dist_m / max(speed_mps, 1e-6) if dist_m > 0 else 0.0

    def pack(arr: list[tuple[float, float]]) -> list[dict[str, float]]:
        return [{"lat": float(a), "lng": float(b)} for a, b in arr]

    return {
        "status": "ok",
        "full_route": pack(full_route),
        "dense": pack(dense),
        "stats": {
            "distance_m": float(dist_m),
            "eta_s": float(eta_s),
            "full_points": int(len(full_route)),
            "dense_points": int(len(dense)),
            "loop": bool(req.loop),
            "from_current": bool(req.from_current),
            "mode": req.mode,
        },
    }


def shutdown_route(clear_device: bool = False) -> None:
    stop_route(clear_device=clear_device)