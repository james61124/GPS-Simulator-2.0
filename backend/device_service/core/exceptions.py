import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("walksim")


def register_exception_handlers(app: FastAPI) -> None:
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