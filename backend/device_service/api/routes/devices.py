import asyncio
import logging

from fastapi import APIRouter

from ..schemas.location import ConnectRequest
from ...services.device_service import connect_device, list_connected_devices

router = APIRouter()
log = logging.getLogger("walksim")


@router.get("/devices")
async def devices():
    log.info("list_connected_devices")
    return await asyncio.to_thread(list_connected_devices)


@router.post("/connect")
async def connect(req: ConnectRequest):
    log.info(f"connect udid={req.udid} connType={req.connType} ios={req.ios_version}")
    return await asyncio.to_thread(
        connect_device,
        req.udid,
        req.connType,
        req.ios_version,
    )