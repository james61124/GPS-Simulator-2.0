from typing import Literal, Optional

from pydantic import BaseModel, Field


class LatLngModel(BaseModel):
    lat: float
    lng: float


class ConnectRequest(BaseModel):
    udid: str
    connType: str
    ios_version: Optional[str] = None


class LocationUpdateRequest(BaseModel):
    lat: float
    lng: float


class RoutePreviewRequest(BaseModel):
    points: list[LatLngModel] = Field(..., min_length=2)
    speed_kmh: float = 30
    interval_s: float = 0.5
    pause_s: float = 0.0
    loop: bool = False
    from_current: bool = False
    mode: Literal["walking", "driving", "bicycling"] = "walking"


class RouteSimulateRequest(BaseModel):
    points: list[LatLngModel] = Field(..., min_length=1)
    speed_kmh: float = 30
    interval_s: float = 0.5
    pause_s: float = 0.0
    loop: bool = False
    from_current: bool = False
    mode: Literal["walking", "driving", "bicycling"] = "walking"