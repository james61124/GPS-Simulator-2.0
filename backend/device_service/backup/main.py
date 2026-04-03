# main.py

import asyncio
import logging
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from . import ops
from .ops import RoutePreviewRequest


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(threadName)s | [%(request_id)s] %(message)s",
    )


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True


setup_logging()
for name in ["walksim", "walksim.device"]:
    logging.getLogger(name).addFilter(RequestIdFilter())

log = logging.getLogger("walksim")

app = FastAPI(title="WalkSim Device Service")


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:8]
    request.state.request_id = request_id

    old_factory = logging.getLogRecordFactory()

    def record_factory(*args, **kwargs):
        record = old_factory(*args, **kwargs)
        record.request_id = request_id
        return record

    logging.setLogRecordFactory(record_factory)

    try:
        resp = await call_next(request)
        resp.headers["x-request-id"] = request_id
        return resp
    finally:
        logging.setLogRecordFactory(old_factory)


@app.exception_handler(Exception)
async def any_exc_handler(request: Request, exc: Exception):
    log.exception(f"unhandled err={exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": str(exc),
            "request_id": getattr(request.state, "request_id", "-"),
        },
    )


@app.get("/devices")
async def devices():
    log.info("list_connected_devices")
    data = await asyncio.to_thread(ops.list_connected_devices)
    return data


@app.post("/connect")
async def connect(payload: dict):
    udid = payload.get("udid")
    conn_type = payload.get("connType")
    ios_version = payload.get("ios_version")

    if not udid or not conn_type:
        return JSONResponse(status_code=400, content={"error": "missing udid or connType"})

    log.info(f"connect udid={udid} connType={conn_type} ios={ios_version}")
    data = await asyncio.to_thread(ops.connect_device, udid, conn_type, ios_version)
    return data


@app.post("/location/update")
async def location_update(payload: dict):
    lat = payload.get("lat")
    lng = payload.get("lng")

    if lat is None or lng is None:
        return JSONResponse(status_code=400, content={"error": "missing lat or lng"})

    log.info(f"update_location lat={lat} lng={lng}")
    data = ops.update_location(float(lat), float(lng))
    return data


@app.post("/location/simulate")
async def location_simulate():
    log.info("simulate_location")
    data = await asyncio.to_thread(ops.simulate_location)
    return data


@app.post("/location/stop")
async def location_stop():
    log.info("stop_location")
    data = await asyncio.to_thread(ops.stop_location, True)
    return data


@app.post("/location/route/preview")
async def route_preview(req: RoutePreviewRequest):
    try:
        log.info(
            f"route_preview n={len(req.points)} speed={req.speed_kmh} "
            f"interval={req.interval_s} loop={req.loop} from_current={req.from_current} mode={req.mode}"
        )
        data = await asyncio.to_thread(ops.preview_route, req)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/location/route/simulate")
async def route_simulate(payload: dict):
    points = payload.get("points")
    speed_kmh = float(payload.get("speed_kmh", 30))
    interval_s = float(payload.get("interval_s", 0.5))
    pause_s = float(payload.get("pause_s", 0.0))
    loop = bool(payload.get("loop", False))
    from_current = bool(payload.get("from_current", False))
    mode = str(payload.get("mode", "walking"))

    if not points or len(points) < 1:
        return JSONResponse(status_code=400, content={"error": "missing points"})

    log.info(
        f"route_simulate n={len(points)} speed={speed_kmh} "
        f"interval={interval_s} pause={pause_s} loop={loop} "
        f"from_current={from_current} mode={mode}"
    )

    data = await asyncio.to_thread(
        ops.simulate_route,
        points,
        speed_kmh,
        interval_s,
        pause_s,
        loop,
        from_current,
        mode,
    )
    return data


@app.post("/location/route/stop")
async def route_stop():
    log.info("stop_route")
    data = await asyncio.to_thread(ops.stop_route, True)
    return data


@app.on_event("shutdown")
def on_shutdown():
    ops.shutdown()

@app.get("/location/route/status")
async def route_status():
    return await asyncio.to_thread(ops.get_route_status)