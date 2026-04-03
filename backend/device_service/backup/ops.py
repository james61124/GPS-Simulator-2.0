# ops.py

from dotenv import load_dotenv
load_dotenv()

import asyncio
import logging
import math
import os
import shlex
import socket
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import polyline
import requests
from pydantic import BaseModel, Field

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
from pymobiledevice3.usbmux import list_devices

from ..state import STATE


log = logging.getLogger("walksim.device")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
_ROUTE_CACHE: dict[tuple, list[tuple[float, float]]] = {}

# keep compatibility with old main.py if anything still imports DEVICE_LOCK
class _NoopAsyncLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


DEVICE_LOCK = _NoopAsyncLock()


# -----------------------------
# tunnel / session helpers
# -----------------------------

def _bump_session_generation_locked() -> int:
    STATE.session_generation += 1
    return STATE.session_generation


def _current_session_generation() -> int:
    with STATE.device_lock:
        return STATE.session_generation


def _kill_existing_tunnel_locked() -> None:
    proc = STATE.tunnel_proc
    if proc is not None and proc.poll() is None:
        try:
            log.warning("kill tunnel proc")
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=2)
                except Exception:
                    pass
        except Exception as e:
            log.warning(f"kill tunnel failed err={e}")

    STATE.tunnel_proc = None
    STATE.tunnel_udid = None
    STATE.rsd_host = None
    STATE.rsd_port = None
    _bump_session_generation_locked()


def _probe_rsd_ipv6(addr: str, port: int, timeout_s: float = 0.8) -> bool:
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s.settimeout(timeout_s)
        s.connect((addr, port))
        s.close()
        return True
    except Exception:
        return False


def ensure_tunnel_and_rsd(target_udid: str) -> Tuple[str, int]:
    """
    Start pymobiledevice3 tunnel via CLI and parse RSD Address/Port from stdout
    Keep process alive so tunnel stays alive
    """
    with STATE.device_lock:
        if (
            STATE.tunnel_proc is not None
            and STATE.tunnel_proc.poll() is None
            and STATE.tunnel_udid == target_udid
            and STATE.rsd_host is not None
            and STATE.rsd_port is not None
        ):
            if _probe_rsd_ipv6(STATE.rsd_host, STATE.rsd_port):
                return STATE.rsd_host, STATE.rsd_port
            log.warning("cached rsd not reachable, rebuilding tunnel")
            _kill_existing_tunnel_locked()

        py = os.environ.get("PYTHON") or sys.executable
        cmd = [py, "-u", "-m", "pymobiledevice3", "lockdown", "start-tunnel", "--udid", target_udid]
        log.info(f"start tunnel cmd={' '.join(shlex.quote(x) for x in cmd)}")

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )

        STATE.tunnel_proc = proc
        STATE.tunnel_udid = target_udid

        addr: Optional[str] = None
        port: Optional[int] = None
        tail: list[str] = []

        deadline = time.time() + 30
        while time.time() < deadline:
            line = proc.stdout.readline() if proc.stdout else ""
            if not line:
                if proc.poll() is not None:
                    rc = proc.returncode
                    _kill_existing_tunnel_locked()
                    raise RuntimeError(f"tunnel process exited early rc={rc}\n" + "".join(tail[-80:]))
                time.sleep(0.05)
                continue

            line = line.strip()
            tail.append(line + "\n")
            log.info(f"[tunnel] {line}")

            if "RSD Address:" in line:
                addr = line.split("RSD Address:", 1)[1].strip()
            elif "RSD Port:" in line:
                try:
                    port = int(line.split("RSD Port:", 1)[1].strip())
                except ValueError:
                    port = None

            if addr is not None and port is not None:
                for _ in range(40):
                    if _probe_rsd_ipv6(addr, port):
                        STATE.rsd_host = addr
                        STATE.rsd_port = port
                        _bump_session_generation_locked()
                        time.sleep(1.0)  # let utun / ipv6 settle a bit
                        log.info(f"tunnel ready rsd={addr}:{port}")
                        return addr, port
                    time.sleep(0.2)

                _kill_existing_tunnel_locked()
                raise RuntimeError(f"RSD not reachable after tunnel output {addr}:{port}\n" + "".join(tail[-80:]))

        _kill_existing_tunnel_locked()
        raise RuntimeError("timeout waiting RSD from tunnel\n" + "".join(tail[-80:]))


def _rebuild_tunnel_for_current_udid() -> Tuple[str, int]:
    with STATE.device_lock:
        udid = STATE.udid
        if not udid:
            raise RuntimeError("no connected device")
        _kill_existing_tunnel_locked()
    return ensure_tunnel_and_rsd(udid)


def _thread_matches(cur: threading.Thread, target: Optional[threading.Thread]) -> bool:
    return target is not None and cur.ident == target.ident


def _route_set_status(
    *,
    status: Optional[str] = None,
    progress_index: Optional[int] = None,
    total_points: Optional[int] = None,
    last_ok_location: Optional[Tuple[float, float]] = None,
    error: Optional[str] = None,
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


# -----------------------------
# device operations
# -----------------------------

def list_connected_devices() -> Dict:
    connected: Dict = {}
    for d in list_devices():
        if d.connection_type != "USB":
            continue
        udid = d.serial
        conn = d.connection_type
        lockdown = create_using_usbmux(udid, connection_type=conn, autopair=True)
        info = dict(lockdown.short_info)
        connected.setdefault(udid, {}).setdefault(conn, []).append(info)
    return connected


def connect_device(udid: str, conn_type: str, ios_version: Optional[str]) -> Dict:
    if conn_type != "USB":
        raise RuntimeError("only support USB for now")

    with STATE.device_lock:
        STATE.udid = udid
        STATE.conn_type = conn_type
        STATE.ios_version = ios_version

    host, port = ensure_tunnel_and_rsd(udid)
    return {
        "udid": udid,
        "connType": conn_type,
        "ios_version": ios_version,
        "rsd": {"host": host, "port": port},
    }


def update_location(lat: float, lng: float) -> Dict:
    with STATE.device_lock:
        STATE.last_location = (lat, lng)
    return {"lat": lat, "lng": lng}


async def _clear_location_async(host: str, port: int) -> None:
    async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
        with DvtSecureSocketProxyService(sp_rsd) as dvt:
            LocationSimulation(dvt).clear()


def stop_location(clear_device: bool = True) -> Dict:
    with STATE.device_lock:
        t = STATE.location_thread
        evt = STATE.location_stop_evt
        udid = STATE.udid
        if t is not None and t.is_alive():
            evt.set()

    if t is not None and t.is_alive():
        try:
            t.join(timeout=5)
        except Exception:
            pass

    with STATE.device_lock:
        if STATE.location_thread is t and (t is None or not t.is_alive()):
            STATE.location_thread = None
            STATE.location_stop_evt = threading.Event()

    if clear_device and udid is not None:
        try:
            host, port = ensure_tunnel_and_rsd(udid)
            asyncio.run(_clear_location_async(host, port))
        except Exception as e:
            log.warning(f"clear location failed err={e}")

    return {"status": "stopped"}


def _location_worker(lat: float, lng: float, my_generation: int) -> None:
    async def _run() -> None:
        with STATE.device_lock:
            udid = STATE.udid
            stop_evt = STATE.location_stop_evt

        if udid is None:
            raise RuntimeError("no connected device")

        host, port = ensure_tunnel_and_rsd(udid)

        async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
            with DvtSecureSocketProxyService(sp_rsd) as dvt:
                sim = LocationSimulation(dvt)

                if my_generation != _current_session_generation():
                    log.warning("location worker sees stale session before set, exit")
                    return

                sim.set(str(lat), str(lng))
                log.warning("Location Set Successfully")

                while not stop_evt.is_set():
                    if my_generation != _current_session_generation():
                        log.warning("location worker sees session changed, exit")
                        return
                    await asyncio.sleep(0.5)

    try:
        asyncio.run(_run())
    except OSError as e:
        log.exception(f"location worker socket/tunnel error err={e}")
    except Exception as e:
        log.exception(f"location worker failed err={e}")
    finally:
        cur = threading.current_thread()
        with STATE.device_lock:
            if _thread_matches(cur, STATE.location_thread):
                STATE.location_thread = None
                STATE.location_stop_evt = threading.Event()


def simulate_location() -> Dict:
    with STATE.device_lock:
        last = STATE.last_location
    if last is None:
        raise RuntimeError("no location set, call update first")

    lat, lng = last

    stop_route(clear_device=False)
    stop_location(clear_device=False)

    with STATE.device_lock:
        STATE.location_stop_evt = threading.Event()
        my_generation = STATE.session_generation
        t = threading.Thread(target=_location_worker, args=(lat, lng, my_generation), daemon=True)
        STATE.location_thread = t
        t.start()

    return {"status": "running", "lat": lat, "lng": lng}


def shutdown() -> None:
    try:
        stop_route(clear_device=False)
        stop_location(clear_device=False)
    finally:
        with STATE.device_lock:
            _kill_existing_tunnel_locked()


# -----------------------------
# route helpers
# -----------------------------

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


# -----------------------------
# route simulation
# -----------------------------

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

                probe_ok = _probe_rsd_ipv6(host, port)
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
                                probe_ok = _probe_rsd_ipv6(host, port)
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
                    _rebuild_tunnel_for_current_udid()
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


# -----------------------------
# preview
# -----------------------------

class LatLngModel(BaseModel):
    lat: float
    lng: float


class RoutePreviewRequest(BaseModel):
    points: list[LatLngModel] = Field(..., min_length=2)
    speed_kmh: float = 30
    interval_s: float = 0.5
    pause_s: float = 0.0
    loop: bool = False
    from_current: bool = False
    mode: str = "walking"


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