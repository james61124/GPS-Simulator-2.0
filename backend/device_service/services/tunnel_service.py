import logging
import os
import shlex
import socket
import subprocess
import sys
import time
from typing import Optional, Tuple

from ..state import STATE

log = logging.getLogger("walksim.device")


def _bump_session_generation_locked() -> int:
    STATE.session_generation += 1
    return STATE.session_generation


def current_session_generation() -> int:
    with STATE.device_lock:
        return STATE.session_generation


def kill_existing_tunnel_locked() -> None:
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


def probe_rsd_ipv6(addr: str, port: int, timeout_s: float = 0.8) -> bool:
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
            if probe_rsd_ipv6(STATE.rsd_host, STATE.rsd_port):
                return STATE.rsd_host, STATE.rsd_port

            log.warning("cached rsd not reachable, rebuilding tunnel")
            kill_existing_tunnel_locked()

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
                    kill_existing_tunnel_locked()
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
                    if probe_rsd_ipv6(addr, port):
                        STATE.rsd_host = addr
                        STATE.rsd_port = port
                        _bump_session_generation_locked()
                        time.sleep(1.0)
                        log.info(f"tunnel ready rsd={addr}:{port}")
                        return addr, port
                    time.sleep(0.2)

                kill_existing_tunnel_locked()
                raise RuntimeError(f"RSD not reachable after tunnel output {addr}:{port}\n" + "".join(tail[-80:]))

        kill_existing_tunnel_locked()
        raise RuntimeError("timeout waiting RSD from tunnel\n" + "".join(tail[-80:]))


def rebuild_tunnel_for_current_udid() -> Tuple[str, int]:
    with STATE.device_lock:
        udid = STATE.udid
        if not udid:
            raise RuntimeError("no connected device")
        kill_existing_tunnel_locked()

    return ensure_tunnel_and_rsd(udid)


def shutdown_tunnel() -> None:
    with STATE.device_lock:
        kill_existing_tunnel_locked()