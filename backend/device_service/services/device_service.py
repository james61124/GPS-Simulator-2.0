from typing import Any, Dict, Optional

from pymobiledevice3.lockdown import create_using_tcp, create_using_usbmux
from pymobiledevice3.usbmux import list_devices

from ..state import STATE
from .tunnel_service import ensure_tunnel_and_rsd


def _normalize_conn_type(conn_type: str) -> str:
    if conn_type == "Network":
        return "Wifi"
    return conn_type


def _safe_get_device_info(udid: str, connection_type: str) -> Dict[str, Any]:
    """
    Read device short_info safely.
    Also try enabling wifi connections when device is reachable via usbmux.
    """
    try:
        lockdown = create_using_usbmux(udid, connection_type=connection_type, autopair=True)
        info = dict(lockdown.short_info)

        try:
            wifi_state = lockdown.enable_wifi_connections
            if wifi_state is False:
                wifi_state = lockdown.enable_wifi_connections = True
            info["wifiState"] = wifi_state
        except Exception as e:
            info["wifiState"] = None
            info["wifiStateError"] = str(e)

        info["ConnectionType"] = _normalize_conn_type(connection_type)
        info["udid"] = udid
        return info

    except Exception as e:
        return {
            "udid": udid,
            "ConnectionType": _normalize_conn_type(connection_type),
            "error": f"failed to read short_info: {e}",
        }


def list_connected_devices() -> Dict[str, Any]:
    connected_devices: Dict[str, Any] = {}

    all_devices = list_devices()

    for device in all_devices:
        udid = device.serial
        raw_conn_type = getattr(device, "connection_type", "UNKNOWN")
        display_conn_type = _normalize_conn_type(raw_conn_type)

        info = _safe_get_device_info(udid, raw_conn_type)

        if udid not in connected_devices:
            connected_devices[udid] = {}

        if display_conn_type not in connected_devices[udid]:
            connected_devices[udid][display_conn_type] = []

        connected_devices[udid][display_conn_type].append(info)

    return connected_devices


def connect_device(udid: str, conn_type: str, ios_version: Optional[str]) -> Dict[str, Any]:
    """
    For now:
    - USB and Wifi both go through ensure_tunnel_and_rsd()
    - Whether Wifi succeeds depends on your local pymobiledevice3 setup / pairing state
    """
    normalized = conn_type.strip() if conn_type else ""

    if normalized not in {"USB", "Wifi", "Network", "Manual Wifi"}:
        raise RuntimeError(f"unsupported connType={conn_type}")

    with STATE.device_lock:
        STATE.udid = udid
        STATE.conn_type = normalized
        STATE.ios_version = ios_version

    host, port = ensure_tunnel_and_rsd(udid)

    return {
        "udid": udid,
        "connType": normalized,
        "ios_version": ios_version,
        "rsd": {"host": host, "port": port},
    }