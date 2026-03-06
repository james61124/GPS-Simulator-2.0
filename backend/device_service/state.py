import subprocess
import threading
from dataclasses import dataclass, field
from typing import Optional, Tuple

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

STATE = DeviceState()