from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .api.routes.devices import router as devices_router
from .api.routes.location import router as location_router
from .core.exceptions import register_exception_handlers
from .core.logging import RequestIdMiddleware, setup_logging
from .services.location_service import shutdown_location
from .services.route_service import shutdown_route
from .services.tunnel_service import shutdown_tunnel


_pending_ticket: str | None = None

setup_logging()

app = FastAPI(title="WalkSim Device Service")
app.add_middleware(RequestIdMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "tauri://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(devices_router, prefix="/api")
app.include_router(location_router)


@app.get("/health")
def health():
    return {"ok": True}


@app.on_event("shutdown")
def on_shutdown() -> None:
    try:
        shutdown_route(clear_device=False)
        shutdown_location(clear_device=False)
    finally:
        shutdown_tunnel()

@app.get("/auth/complete")
def auth_complete(ticket: str = Query(...)):
    global _pending_ticket
    _pending_ticket = ticket
    return HTMLResponse("""
    <html>
      <body style="font-family: sans-serif; padding: 24px;">
        <h3>Login complete</h3>
        <p>You can return to SprytePath now.</p>
      </body>
    </html>
    """)

@app.get("/auth/pending")
def auth_pending():
    return {"ticket": _pending_ticket}

@app.post("/auth/clear")
def auth_clear():
    global _pending_ticket
    _pending_ticket = None
    return {"ok": True}