from fastapi import FastAPI

from .api.routes.devices import router as devices_router
from .api.routes.location import router as location_router
from .core.exceptions import register_exception_handlers
from .core.logging import RequestIdMiddleware, setup_logging
from .services.location_service import shutdown_location
from .services.route_service import shutdown_route
from .services.tunnel_service import shutdown_tunnel

setup_logging()

app = FastAPI(title="WalkSim Device Service")
app.add_middleware(RequestIdMiddleware)

register_exception_handlers(app)

app.include_router(devices_router)
app.include_router(location_router)


@app.on_event("shutdown")
def on_shutdown() -> None:
    try:
        shutdown_route(clear_device=False)
        shutdown_location(clear_device=False)
    finally:
        shutdown_tunnel()