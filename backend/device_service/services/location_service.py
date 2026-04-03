import asyncio
import logging
import threading
from typing import Dict

from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

from ..state import STATE
from .tunnel_service import current_session_generation, ensure_tunnel_and_rsd

log = logging.getLogger("walksim.device")


def _thread_matches(cur: threading.Thread, target: threading.Thread | None) -> bool:
    return target is not None and cur.ident == target.ident


async def _clear_location_async(host: str, port: int) -> None:
    async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
        with DvtSecureSocketProxyService(sp_rsd) as dvt:
            LocationSimulation(dvt).clear()


def update_location(lat: float, lng: float) -> Dict:
    with STATE.device_lock:
        STATE.last_location = (lat, lng)
    return {"lat": lat, "lng": lng}


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

                if my_generation != current_session_generation():
                    log.warning("location worker sees stale session before set, exit")
                    return

                sim.set(str(lat), str(lng))
                log.warning("Location Set Successfully")

                while not stop_evt.is_set():
                    if my_generation != current_session_generation():
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
    from .route_service import stop_route

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


def shutdown_location(clear_device: bool = False) -> None:
    stop_location(clear_device=clear_device)