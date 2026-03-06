from dotenv import load_dotenv
load_dotenv()

import asyncio
import logging
import socket
import subprocess
import time
from typing import List, Dict, Tuple, Optional

from pymobiledevice3.usbmux import list_devices
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService

from .state import STATE

import os
import requests
import polyline
import math
import sys
import selectors
import select
import shutil
import shlex

log = logging.getLogger("walksim.device")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
_ROUTE_CACHE: dict[tuple, list[tuple[float,float]]] = {}

# serialize all device ops
DEVICE_LOCK = asyncio.Lock()

def _kill_existing_tunnel() -> None:
    if STATE.tunnel_proc is not None and STATE.tunnel_proc.poll() is None:
        try:
            log.warning("kill tunnel proc")
            STATE.tunnel_proc.terminate()
            try:
                STATE.tunnel_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                STATE.tunnel_proc.kill()
        except Exception as e:
            log.warning(f"kill tunnel failed err={e}")

    STATE.tunnel_proc = None
    STATE.tunnel_udid = None
    STATE.rsd_host = None
    STATE.rsd_port = None

def _probe_rsd_ipv6(addr: str, port: int, timeout_s: float = 0.8) -> bool:
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s.settimeout(timeout_s)
        s.connect((addr, port))
        s.close()
        return True
    except Exception:
        return False

def _drain_tail(proc: subprocess.Popen, max_lines: int = 80) -> str:
    try:
        if not proc.stdout:
            return ""
        lines = []
        for _ in range(max_lines):
            line = proc.stdout.readline()
            if not line:
                break
            lines.append(line.rstrip("\n"))
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""

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
    Start pymobiledevice3 tunnel via CLI and parse RSD Address/Port from stdout.
    Keeps the process running so the tunnel stays alive.
    Returns (rsd_host, rsd_port).
    """
    if (
        STATE.tunnel_proc is not None
        and STATE.tunnel_proc.poll() is None
        and STATE.tunnel_udid == target_udid
        and STATE.rsd_host is not None
        and STATE.rsd_port is not None
    ):
        return STATE.rsd_host, STATE.rsd_port

    _kill_existing_tunnel()

    # 關鍵：-u + --udid + 確保用你這個 venv 的 python
    py = os.environ.get("PYTHON", None) or sys.executable
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

        # 一定要等 addr + port 都有了才 probe
        if addr is not None and port is not None:
            # 給它一些時間等 utun/ipv6 ready
            for _ in range(40):  # ~8s
                if _probe_rsd_ipv6(addr, port):
                    STATE.rsd_host = addr
                    STATE.rsd_port = port
                    log.info(f"tunnel ready rsd={addr}:{port}")
                    return addr, port
                time.sleep(0.2)

            raise RuntimeError(f"RSD not reachable after tunnel output {addr}:{port}\n" + "".join(tail[-80:]))

    _kill_existing_tunnel()
    raise RuntimeError("timeout waiting RSD from tunnel\n" + "".join(tail[-80:]))

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
    STATE.udid = udid
    STATE.conn_type = conn_type
    STATE.ios_version = ios_version

    if conn_type != "USB":
        raise RuntimeError("only support USB for now")

    host, port = ensure_tunnel_and_rsd(udid)
    return {"udid": udid, "connType": conn_type, "ios_version": ios_version, "rsd": {"host": host, "port": port}}

def update_location(lat: float, lng: float) -> Dict:
    STATE.last_location = (lat, lng)
    return {"lat": lat, "lng": lng}

def _location_worker(lat: float, lng: float) -> None:
    async def _run() -> None:
        if STATE.udid is None:
            raise RuntimeError("no connected device")

        host, port = ensure_tunnel_and_rsd(STATE.udid)

        async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
            with DvtSecureSocketProxyService(sp_rsd) as dvt:
                LocationSimulation(dvt).set(str(lat), str(lng))
                log.warning("Location Set Successfully")
                while not STATE.location_stop_evt.is_set():
                    await asyncio.sleep(0.5)

    asyncio.run(_run())

def simulate_location() -> Dict:
    if STATE.last_location is None:
        raise RuntimeError("no location set, call update first")

    lat, lng = STATE.last_location

    stop_location(clear_device=False)

    import threading
    STATE.location_stop_evt = threading.Event()
    t = threading.Thread(target=_location_worker, args=(lat, lng), daemon=True)
    STATE.location_thread = t
    t.start()

    return {"status": "running", "lat": lat, "lng": lng}

def stop_location(clear_device: bool = True) -> Dict:
    if STATE.location_thread is not None and STATE.location_thread.is_alive():
        STATE.location_stop_evt.set()
        try:
            STATE.location_thread.join(timeout=2)
        except Exception:
            pass

    STATE.location_thread = None
    STATE.location_stop_evt = __import__("threading").Event()

    if clear_device and STATE.udid is not None:
        try:
            host, port = ensure_tunnel_and_rsd(STATE.udid)
            async def _clear():
                async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
                    with DvtSecureSocketProxyService(sp_rsd) as dvt:
                        LocationSimulation(dvt).clear()
            asyncio.run(_clear())
        except Exception as e:
            log.warning(f"clear location failed err={e}")

    return {"status": "stopped"}

def shutdown() -> None:
    try:
        stop_location(clear_device=False)
    finally:
        _kill_existing_tunnel()


# Plant

def _decode_polyline(points_str: str) -> list[tuple[float, float]]:
    return polyline.decode(points_str)

def _get_route_steps_google(origin: tuple[float,float], dest: tuple[float,float], mode: str = "walking") -> list[dict]:
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

def _steps_to_route_points(steps: list[dict]) -> list[tuple[float,float]]:
    route_points: list[tuple[float,float]] = []
    for step in steps:
        pts = _decode_polyline(step["polyline"]["points"])
        if not pts:
            continue
        if route_points:
            pts = pts[1:]  # drop duplicate join
        route_points.extend(pts)
    return route_points

def _route_points_between(a: tuple[float,float], b: tuple[float,float], mode: str = "walking") -> list[tuple[float,float]]:
    # cache key with rounding to avoid exploding cardinality
    key = (round(a[0], 6), round(a[1], 6), round(b[0], 6), round(b[1], 6), mode)
    hit = _ROUTE_CACHE.get(key)
    if hit is not None and len(hit) >= 2:
        return hit

    steps = _get_route_steps_google(a, b, mode=mode)
    pts = _steps_to_route_points(steps)

    # fallback if google returns too few points
    if not pts or len(pts) < 2:
        pts = [a, b]

    _ROUTE_CACHE[key] = pts
    return pts

def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def _interpolate(a: Tuple[float,float], b: Tuple[float,float], t: float) -> Tuple[float,float]:
    return (a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)

def _densify_by_time(points: List[Tuple[float,float]], speed_mps: float, interval_s: float) -> List[Tuple[float,float]]:
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

def _sleep_until(deadline_s: float, stop_evt) -> None:
    while True:
        if stop_evt.is_set():
            return
        remain = deadline_s - _now_s()
        if remain <= 0:
            return
        time.sleep(min(0.2, remain))

def _build_full_route_points(pts: list[tuple[float,float]], loop: bool, mode: str = "walking") -> list[tuple[float,float]]:
    if len(pts) < 2:
        return pts

    out: list[tuple[float,float]] = [pts[0]]
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

def simulate_route(points: list[dict], speed_kmh: float = 30, interval_s: float = 0.5, pause_s: float = 0.0, loop: bool = False, from_current: bool = False) -> dict:
    if from_current:
        if STATE.last_location is None:
            raise RuntimeError("from_current=true but no last_location, call update_location first")
        lat, lng = STATE.last_location
        points = [{"lat": lat, "lng": lng}] + points

    if not points or len(points) < 2:
        raise RuntimeError("need at least 2 points")

    stop_route(clear_device=False)
    stop_location(clear_device=False)

    import threading
    STATE.route_stop_evt = threading.Event()
    STATE.route_plan = {
        "points": points,
        "speed_kmh": speed_kmh,
        "interval_s": interval_s,
        "pause_s": pause_s,
        "loop": loop,
        "from_current": from_current,
        "mode": "walking",
    }

    t = threading.Thread(
        target=_route_worker,
        args=(points, speed_kmh, interval_s, pause_s, loop),
        daemon=True,
    )
    STATE.route_thread = t
    t.start()

    return {"status": "running", **STATE.route_plan}

def _route_worker(points: List[Dict], speed_kmh: float, interval_s: float, pause_s: float, loop: bool) -> None:
    async def _run() -> None:
        if STATE.udid is None:
            raise RuntimeError("no connected device")

        host, port = ensure_tunnel_and_rsd(STATE.udid)

        raw_pts = [(float(p["lat"]), float(p["lng"])) for p in points]
        full_route = _build_full_route_points(raw_pts, loop=loop)

        speed_mps = float(speed_kmh) * 1000.0 / 3600.0
        dense = _densify_by_time(full_route, speed_mps, float(interval_s))
        if not dense:
            raise RuntimeError("route densify produced empty point list")

        async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
            with DvtSecureSocketProxyService(sp_rsd) as dvt:
                sim = LocationSimulation(dvt)

                next_tick = _now_s()
                i = 0
                while not STATE.route_stop_evt.is_set():
                    if i >= len(dense):
                        if pause_s and pause_s > 0:
                            # pause at end (hold last point)
                            end_deadline = _now_s() + float(pause_s)
                            while _now_s() < end_deadline and not STATE.route_stop_evt.is_set():
                                sim.set(str(dense[-1][0]), str(dense[-1][1]))
                                await asyncio.sleep(min(0.5, float(interval_s)))
                        if loop:
                            i = 0
                            continue
                        break

                    lat, lng = dense[i]
                    sim.set(str(lat), str(lng))
                    i += 1

                    next_tick += float(interval_s)
                    # keep steady timing even if set() takes time
                    while True:
                        if STATE.route_stop_evt.is_set():
                            break
                        remain = next_tick - _now_s()
                        if remain <= 0:
                            break
                        await asyncio.sleep(min(0.2, remain))

    asyncio.run(_run())

def stop_route(clear_device: bool = True) -> Dict:
    if getattr(STATE, "route_thread", None) is not None and STATE.route_thread.is_alive():
        STATE.route_stop_evt.set()
        try:
            STATE.route_thread.join(timeout=2)
        except Exception:
            pass

    STATE.route_thread = None
    STATE.route_stop_evt = __import__("threading").Event()

    if clear_device and STATE.udid is not None:
        try:
            host, port = ensure_tunnel_and_rsd(STATE.udid)
            async def _clear():
                async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
                    with DvtSecureSocketProxyService(sp_rsd) as dvt:
                        LocationSimulation(dvt).clear()
            asyncio.run(_clear())
        except Exception as e:
            log.warning(f"clear location failed err={e}")

    return {"status": "stopped"}

# ops.py (加在 route helper 區塊附近)
from pydantic import BaseModel, Field
from typing import Any

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
    # from_current 行為跟 simulate_route 一致
    pts_models = req.points
    if req.from_current:
        if STATE.last_location is None:
            raise RuntimeError("from_current=true but no last_location, call update_location first")
        lat, lng = STATE.last_location
        pts_models = [LatLngModel(lat=lat, lng=lng)] + pts_models

    if not pts_models or len(pts_models) < 2:
        raise RuntimeError("need at least 2 points")

    raw_pts: list[tuple[float, float]] = [(float(p.lat), float(p.lng)) for p in pts_models]

    # 走道路：A->B->C 用 google directions
    full_route = _build_full_route_points(raw_pts, loop=bool(req.loop), mode=req.mode)
    if not full_route or len(full_route) < 2:
        full_route = raw_pts

    # 依速度/interval densify
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