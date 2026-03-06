import asyncio
import socket
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Tuple

from pymobiledevice3.usbmux import list_devices
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService

from . import logging_setup  # 上面那個檔案叫 logging_setup.py

logger = logging_setup.setup_logging("walksim")


def _rid() -> str:
    return uuid.uuid4().hex[:8]


@dataclass
class DeviceSession:
    udid: Optional[str] = None
    conn_type: Optional[str] = None
    ios_version: Optional[str] = None

    rsd_host: Optional[str] = None
    rsd_port: Optional[int] = None

    tunnel_proc: Optional[subprocess.Popen] = None
    tunnel_udid: Optional[str] = None

    last_location: Optional[Tuple[float, float]] = None

    location_stop_evt: threading.Event = field(default_factory=threading.Event)
    location_thread: Optional[threading.Thread] = None


STATE = DeviceSession()


def _kill_existing_tunnel(reason: str = "") -> None:
    if STATE.tunnel_proc is not None and STATE.tunnel_proc.poll() is None:
        try:
            logger.warning(f"kill tunnel proc reason={reason}")
            STATE.tunnel_proc.terminate()
            try:
                STATE.tunnel_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                STATE.tunnel_proc.kill()
        except Exception as e:
            logger.warning(f"kill tunnel failed err={e}")

    STATE.tunnel_proc = None
    STATE.tunnel_udid = None
    STATE.rsd_host = None
    STATE.rsd_port = None


def _probe_tcp(host: str, port: int, timeout_s: float = 0.8) -> bool:
    # try v6 then v4
    for family in (socket.AF_INET6, socket.AF_INET):
        try:
            s = socket.socket(family, socket.SOCK_STREAM)
            s.settimeout(timeout_s)
            s.connect((host, port))
            s.close()
            return True
        except Exception:
            continue
    return False


def ensure_tunnel_and_rsd(target_udid: str, timeout_s: float = 25.0) -> Tuple[str, int]:
    rid = _rid()
    logger.info(f"[{rid}] ensure_tunnel_and_rsd udid={target_udid}")

    if (
        STATE.tunnel_proc is not None
        and STATE.tunnel_proc.poll() is None
        and STATE.tunnel_udid == target_udid
        and STATE.rsd_host is not None
        and STATE.rsd_port is not None
    ):
        logger.info(f"[{rid}] reuse tunnel rsd={STATE.rsd_host}:{STATE.rsd_port}")
        return STATE.rsd_host, STATE.rsd_port

    _kill_existing_tunnel(reason=f"restart for udid={target_udid}")

    cmd = ["python3", "-m", "pymobiledevice3", "lockdown", "start-tunnel"]
    logger.info(f"[{rid}] start tunnel cmd={' '.join(cmd)}")

    STATE.tunnel_proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    STATE.tunnel_udid = target_udid

    addr: Optional[str] = None
    port: Optional[int] = None

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        line = STATE.tunnel_proc.stdout.readline() if STATE.tunnel_proc.stdout else ""
        if not line:
            if STATE.tunnel_proc.poll() is not None:
                raise RuntimeError("tunnel process exited early")
            time.sleep(0.05)
            continue

        line = line.rstrip("\n")
        logger.debug(f"[{rid}] [tunnel] {line}")

        if "RSD Address:" in line:
            addr = line.split("RSD Address:", 1)[1].strip()
        elif "RSD Port:" in line:
            try:
                port = int(line.split("RSD Port:", 1)[1].strip())
            except ValueError:
                port = None

        if addr and port:
            # wait until reachable
            for i in range(20):
                ok = _probe_tcp(addr, port, timeout_s=0.8)
                logger.debug(f"[{rid}] probe rsd {addr}:{port} ok={ok} i={i}")
                if ok:
                    STATE.rsd_host = addr
                    STATE.rsd_port = port
                    logger.info(f"[{rid}] tunnel ready rsd={addr}:{port}")
                    return addr, port
                time.sleep(0.2)

            raise RuntimeError(f"RSD not reachable {addr}:{port}")

    _kill_existing_tunnel(reason="timeout waiting RSD")
    raise RuntimeError("timeout waiting for RSD from tunnel")


def list_connected_devices() -> dict:
    rid = _rid()
    logger.info(f"[{rid}] list_connected_devices")

    connected: dict = {}
    for d in list_devices():
        udid = d.serial
        conn = d.connection_type
        lockdown = create_using_usbmux(udid, connection_type=conn, autopair=True)
        info = dict(lockdown.short_info)
        if conn == "Network":
            conn = "Wifi"
        connected.setdefault(udid, {}).setdefault(conn, []).append(info)

    logger.info(f"[{rid}] devices_count={len(connected)}")
    return connected


def connect_device(udid: str, conn_type: str, ios_version: Optional[str] = None) -> dict:
    rid = _rid()
    logger.info(f"[{rid}] connect_device udid={udid} conn_type={conn_type} ios={ios_version}")

    STATE.udid = udid
    STATE.conn_type = conn_type
    STATE.ios_version = ios_version

    if conn_type != "USB":
        raise RuntimeError("now only support USB in this minimal rewrite")

    host, port = ensure_tunnel_and_rsd(udid)
    return {"host": host, "port": port}


def update_location(lat: float, lng: float) -> None:
    rid = _rid()
    STATE.last_location = (lat, lng)
    logger.info(f"[{rid}] update_location lat={lat} lng={lng}")


def _location_worker(lat: float, lng: float) -> None:
    rid = _rid()
    logger.info(f"[{rid}] location_worker start lat={lat} lng={lng}")

    async def _run() -> None:
        if STATE.udid is None:
            raise RuntimeError("no connected device")

        host, port = ensure_tunnel_and_rsd(STATE.udid)
        logger.info(f"[{rid}] location_worker rsd={host}:{port}")

        async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
            with DvtSecureSocketProxyService(sp_rsd) as dvt:
                LocationSimulation(dvt).set(str(lat), str(lng))
                logger.info(f"[{rid}] location set ok")
                while not STATE.location_stop_evt.is_set():
                    await asyncio.sleep(0.5)

        logger.info(f"[{rid}] location_worker exit")

    try:
        asyncio.run(_run())
    except Exception as e:
        logger.error(f"[{rid}] location_worker failed err={e}")


def simulate_location() -> None:
    rid = _rid()
    if STATE.last_location is None:
        raise RuntimeError("no location set, call update_location first")

    lat, lng = STATE.last_location
    logger.info(f"[{rid}] simulate_location lat={lat} lng={lng}")

    stop_location(clear_device=False)

    STATE.location_stop_evt = threading.Event()
    t = threading.Thread(target=_location_worker, args=(lat, lng), daemon=True, name="LocationWorker")
    STATE.location_thread = t
    t.start()


def stop_location(clear_device: bool = True) -> None:
    rid = _rid()
    logger.info(f"[{rid}] stop_location clear_device={clear_device}")

    if STATE.location_thread is not None and STATE.location_thread.is_alive():
        STATE.location_stop_evt.set()
        try:
            STATE.location_thread.join(timeout=2)
        except Exception:
            pass

    STATE.location_thread = None
    STATE.location_stop_evt = threading.Event()

    if clear_device:
        try:
            if STATE.udid is None:
                return
            host, port = ensure_tunnel_and_rsd(STATE.udid)

            async def _clear():
                async with RemoteServiceDiscoveryService((host, port)) as sp_rsd:
                    with DvtSecureSocketProxyService(sp_rsd) as dvt:
                        LocationSimulation(dvt).clear()

            asyncio.run(_clear())
            logger.info(f"[{rid}] device location cleared")
        except Exception as e:
            logger.warning(f"[{rid}] clear device location failed err={e}")