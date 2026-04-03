# state.py

import subprocess
import threading
from dataclasses import dataclass, field
from typing import Optional, Tuple, Dict, Any


@dataclass
class DeviceState:
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

    route_stop_evt: threading.Event = field(default_factory=threading.Event)
    route_thread: Optional[threading.Thread] = None
    route_plan: Optional[Dict[str, Any]] = None

    # shared synchronization
    device_lock: threading.RLock = field(default_factory=threading.RLock)

    # increment whenever tunnel/session changes
    session_generation: int = 0

    # route runtime status
    route_status: str = "idle"  # idle/running/reconnecting/failed/stopped/completed
    route_progress_index: int = 0
    route_total_points: int = 0
    route_last_ok_location: Optional[Tuple[float, float]] = None
    route_error: Optional[str] = None


STATE = DeviceState()