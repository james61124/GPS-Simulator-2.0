import asyncio
import logging

from fastapi import APIRouter, HTTPException

from ..schemas.location import (
    LocationUpdateRequest,
    RoutePreviewRequest,
    RouteSimulateRequest,
)
from ...services.location_service import simulate_location, stop_location, update_location
from ...services.route_service import (
    get_route_status,
    preview_route,
    simulate_route,
    stop_route,
)

router = APIRouter()
log = logging.getLogger("walksim")


@router.post("/location/update")
async def location_update(req: LocationUpdateRequest):
    log.info(f"update_location lat={req.lat} lng={req.lng}")
    return update_location(req.lat, req.lng)


@router.post("/location/simulate")
async def location_simulate():
    log.info("simulate_location")
    return await asyncio.to_thread(simulate_location)


@router.post("/location/stop")
async def location_stop():
    log.info("stop_location")
    return await asyncio.to_thread(stop_location, True)


@router.post("/location/route/preview")
async def route_preview_api(req: RoutePreviewRequest):
    try:
        log.info(
            f"route_preview n={len(req.points)} speed={req.speed_kmh} "
            f"interval={req.interval_s} loop={req.loop} "
            f"from_current={req.from_current} mode={req.mode}"
        )
        return await asyncio.to_thread(preview_route, req)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/location/route/simulate")
async def route_simulate_api(req: RouteSimulateRequest):
    log.info(
        f"route_simulate n={len(req.points)} speed={req.speed_kmh} "
        f"interval={req.interval_s} pause={req.pause_s} loop={req.loop} "
        f"from_current={req.from_current} mode={req.mode}"
    )

    points = [{"lat": p.lat, "lng": p.lng} for p in req.points]

    return await asyncio.to_thread(
        simulate_route,
        points,
        req.speed_kmh,
        req.interval_s,
        req.pause_s,
        req.loop,
        req.from_current,
        req.mode,
    )


@router.post("/location/route/stop")
async def route_stop_api():
    log.info("stop_route")
    return await asyncio.to_thread(stop_route, True)


@router.get("/location/route/status")
async def route_status_api():
    return await asyncio.to_thread(get_route_status)