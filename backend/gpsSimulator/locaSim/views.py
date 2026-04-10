import json
import uuid
import logging
import httpx

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse, HttpResponseNotAllowed, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from .models import AppUser, SavedRoute, SavedRouteWaypoint

import requests
from urllib.parse import urlencode
from django.http import HttpResponseRedirect
from django.utils import timezone

from .models import AppUser, SavedRoute, SavedRouteWaypoint, DesktopLoginTicket

log = logging.getLogger("walksim.api")

DEVICE_SERVICE_URL = getattr(
    settings,
    "DEVICE_SERVICE_URL",
    "http://127.0.0.1:9100",
).rstrip("/")


def _request_id(request) -> str:
    return request.headers.get("X-Request-Id") or uuid.uuid4().hex[:8]


def _serialize_user(user: AppUser) -> dict:
    return {
        "id": user.id,
        "sub": user.google_sub,
        "email": user.email,
        "name": user.name,
        "picture": user.picture_url,
        "email_verified": user.email_verified,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


def _serialize_saved_route(route: SavedRoute, include_waypoints: bool = False) -> dict:
    data = {
        "id": route.id,
        "name": route.name,
        "loop": route.loop,
        "speed_kmh": route.speed_kmh,
        "interval_s": route.interval_s,
        "pause_s": route.pause_s,
        "from_current": route.from_current,
        "waypoint_count": route.waypoints.count() if hasattr(route, "waypoints") else 0,
        "created_at": route.created_at.isoformat() if route.created_at else None,
        "updated_at": route.updated_at.isoformat() if route.updated_at else None,
    }

    if include_waypoints:
        data["waypoints"] = [
            {
                "id": wp.id,
                "order_index": wp.order_index,
                "lat": wp.lat,
                "lng": wp.lng,
                "text": wp.text,
            }
            for wp in route.waypoints.all().order_by("order_index")
        ]

    return data


def _get_authenticated_user(request):
    authenticated = bool(request.session.get("authenticated"))
    user_id = request.session.get("user_id")

    if not authenticated or not user_id:
        return None

    try:
        return AppUser.objects.get(id=user_id, is_active=True)
    except AppUser.DoesNotExist:
        request.session.flush()
        return None


def _require_login(request):
    user = _get_authenticated_user(request)
    if not user:
        return None, JsonResponse(
            {
                "authenticated": False,
                "error": "login required",
            },
            status=401,
        )
    return user, None


def _proxy(method: str, path: str, rid: str, payload: dict | None = None):
    url = f"{DEVICE_SERVICE_URL}{path}"
    headers = {"X-Request-Id": rid}

    timeout = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)

    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.request(method, url, headers=headers, json=payload)
            return r.status_code, r.text
    except httpx.ReadTimeout:
        log.exception(f"[{rid}] proxy timeout url={url}")
        return 504, json.dumps({"error": "device service timeout", "request_id": rid})
    except Exception as e:
        log.exception(f"[{rid}] proxy error url={url} err={e}")
        return 502, json.dumps({"error": "device service error", "request_id": rid})


@csrf_exempt
def devices(request):
    rid = _request_id(request)
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])

    log.info(f"[{rid}] list_connected_devices")
    code, text = _proxy("GET", "/devices", rid)
    return JsonResponse(json.loads(text), status=code)


@csrf_exempt
def connect(request):
    rid = _request_id(request)
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    payload = json.loads(request.body.decode("utf-8") or "{}")
    log.info(f"[{rid}] connect payload={payload}")
    code, text = _proxy("POST", "/connect", rid, payload)
    return JsonResponse(json.loads(text), status=code)


@csrf_exempt
def location_update(request):
    rid = _request_id(request)
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    payload = json.loads(request.body.decode("utf-8") or "{}")
    log.info(f"[{rid}] update_location payload={payload}")
    code, text = _proxy("POST", "/location/update", rid, payload)
    return JsonResponse(json.loads(text), status=code)


@csrf_exempt
def location_simulate(request):
    rid = _request_id(request)
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    log.info(f"[{rid}] simulate_location")
    code, text = _proxy("POST", "/location/simulate", rid, None)
    return JsonResponse(json.loads(text), status=code)


@csrf_exempt
def location_stop(request):
    rid = _request_id(request)
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    log.info(f"[{rid}] stop_location")
    code, text = _proxy("POST", "/location/stop", rid, None)
    return JsonResponse(json.loads(text), status=code)


@csrf_exempt
def route_preview(request):
    if request.method != "POST":
        return HttpResponse(status=405)

    try:
        body = request.body.decode("utf-8") or "{}"
        with httpx.Client(timeout=60.0) as client:
            r = client.post(
                f"{DEVICE_SERVICE_URL}/location/route/preview",
                content=body,
                headers={"Content-Type": "application/json"},
            )
        return HttpResponse(r.content, status=r.status_code, content_type="application/json")
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
def location_route_simulate(request):
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return JsonResponse({"error": "invalid json"}, status=400)

    try:
        with httpx.Client(timeout=60.0) as c:
            r = c.post(
                f"{DEVICE_SERVICE_URL}/location/route/simulate",
                json=payload,
                headers=_forward_headers(request),
            )
        return JsonResponse(r.json(), status=r.status_code)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=502)


def _forward_headers(request):
    headers = {}

    if "HTTP_X_REQUEST_ID" in request.META:
        headers["x-request-id"] = request.META["HTTP_X_REQUEST_ID"]

    if "CONTENT_TYPE" in request.META:
        headers["Content-Type"] = request.META["CONTENT_TYPE"]

    return headers


@csrf_exempt
def location_route_stop(request):
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    try:
        with httpx.Client(timeout=30.0) as c:
            r = c.post(
                f"{DEVICE_SERVICE_URL}/location/route/stop",
                headers=_forward_headers(request),
            )
        return JsonResponse(r.json(), status=r.status_code)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=502)


@csrf_exempt
@require_http_methods(["POST"])
def auth_google(request):
    rid = _request_id(request)

    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return JsonResponse({"error": "invalid json", "request_id": rid}, status=400)

    token = body.get("idToken")
    if not token:
        return JsonResponse({"error": "missing idToken", "request_id": rid}, status=400)

    if not settings.GOOGLE_CLIENT_ID:
        return JsonResponse(
            {"error": "GOOGLE_CLIENT_ID is not configured", "request_id": rid},
            status=500,
        )

    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except Exception as e:
        log.exception(f"[{rid}] google token verify failed err={e}")
        return JsonResponse(
            {"error": "invalid Google ID token", "request_id": rid},
            status=401,
        )

    issuer = idinfo.get("iss")
    if issuer not in ["accounts.google.com", "https://accounts.google.com"]:
        return JsonResponse({"error": "invalid issuer", "request_id": rid}, status=401)

    google_sub = idinfo.get("sub")
    email = idinfo.get("email")
    name = idinfo.get("name")
    picture = idinfo.get("picture")
    email_verified = bool(idinfo.get("email_verified"))

    if not google_sub or not email:
        return JsonResponse(
            {"error": "missing required Google user fields", "request_id": rid},
            status=400,
        )

    try:
        db_user, created = AppUser.objects.update_or_create(
            google_sub=google_sub,
            defaults={
                "email": email,
                "name": name,
                "picture_url": picture,
                "email_verified": email_verified,
                "is_active": True,
            },
        )
    except Exception as e:
        log.exception(f"[{rid}] failed to save user err={e}")
        return JsonResponse(
            {"error": "failed to save user", "request_id": rid},
            status=500,
        )

    session_user = _serialize_user(db_user)

    request.session["authenticated"] = True
    request.session["user_id"] = db_user.id
    request.session["user"] = session_user
    request.session.set_expiry(60 * 60 * 24 * 7)

    log.info(
        f"[{rid}] google login success email={db_user.email} sub={db_user.google_sub} created={created}"
    )

    return JsonResponse(
        {
            "authenticated": True,
            "user": session_user,
            "created": created,
        }
    )


@require_http_methods(["GET"])
def auth_session(request):
    authenticated = bool(request.session.get("authenticated"))
    user_id = request.session.get("user_id")

    if not authenticated or not user_id:
        return JsonResponse({
            "authenticated": False,
            "user": None,
        })

    try:
        db_user = AppUser.objects.get(id=user_id, is_active=True)
        session_user = _serialize_user(db_user)
        request.session["user"] = session_user

        return JsonResponse({
            "authenticated": True,
            "user": session_user,
        })
    except AppUser.DoesNotExist:
        request.session.flush()
        return JsonResponse({
            "authenticated": False,
            "user": None,
        })


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(request):
    rid = _request_id(request)
    request.session.flush()
    log.info(f"[{rid}] logout success")
    return JsonResponse({"ok": True})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def saved_routes(request):
    user, auth_error = _require_login(request)
    if auth_error:
        return auth_error

    if request.method == "GET":
        routes = (
            SavedRoute.objects.filter(user=user)
            .prefetch_related("waypoints")
            .order_by("-updated_at")
        )

        return JsonResponse(
            {
                "routes": [
                    _serialize_saved_route(route, include_waypoints=False)
                    for route in routes
                ]
            }
        )

    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return JsonResponse({"error": "invalid json"}, status=400)

    name = (body.get("name") or "").strip()
    waypoints = body.get("waypoints") or []
    loop = bool(body.get("loop", False))
    speed_kmh = body.get("speed_kmh", 18.0)
    interval_s = body.get("interval_s", 0.5)
    pause_s = body.get("pause_s", 0.0)
    from_current = bool(body.get("from_current", False))

    if not name:
        return JsonResponse({"error": "name is required"}, status=400)

    if not isinstance(waypoints, list) or len(waypoints) < 2:
        return JsonResponse({"error": "need at least 2 waypoints"}, status=400)

    try:
        with transaction.atomic():
            route = SavedRoute.objects.create(
                user=user,
                name=name,
                loop=loop,
                speed_kmh=float(speed_kmh),
                interval_s=float(interval_s),
                pause_s=float(pause_s),
                from_current=from_current,
            )

            waypoint_rows = []
            for idx, wp in enumerate(waypoints):
                lat = wp.get("lat")
                lng = wp.get("lng")
                text = wp.get("text") or ""

                if lat is None or lng is None:
                    raise ValueError("each waypoint must include lat and lng")

                waypoint_rows.append(
                    SavedRouteWaypoint(
                        saved_route=route,
                        order_index=idx,
                        lat=float(lat),
                        lng=float(lng),
                        text=text,
                    )
                )

            SavedRouteWaypoint.objects.bulk_create(waypoint_rows)

        route = SavedRoute.objects.prefetch_related("waypoints").get(id=route.id)

        return JsonResponse(
            {
                "ok": True,
                "route": _serialize_saved_route(route, include_waypoints=True),
            },
            status=201,
        )
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except Exception as e:
        log.exception(f"create saved route failed err={e}")
        return JsonResponse({"error": "failed to save route"}, status=500)


@csrf_exempt
@require_http_methods(["GET", "PUT", "DELETE"])
def saved_route_detail(request, route_id: int):
    user, auth_error = _require_login(request)
    if auth_error:
        return auth_error

    try:
        route = (
            SavedRoute.objects
            .filter(user=user, id=route_id)
            .prefetch_related("waypoints")
            .get()
        )
    except SavedRoute.DoesNotExist:
        return JsonResponse({"error": "route not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(
            {
                "route": _serialize_saved_route(route, include_waypoints=True),
            }
        )

    if request.method == "DELETE":
        route.delete()
        return JsonResponse({"ok": True})

    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return JsonResponse({"error": "invalid json"}, status=400)

    name = body.get("name")
    waypoints = body.get("waypoints")
    loop = body.get("loop")
    speed_kmh = body.get("speed_kmh")
    interval_s = body.get("interval_s")
    pause_s = body.get("pause_s")
    from_current = body.get("from_current")

    try:
        with transaction.atomic():
            if name is not None:
                name = str(name).strip()
                if not name:
                    return JsonResponse({"error": "name cannot be empty"}, status=400)
                route.name = name

            if loop is not None:
                route.loop = bool(loop)

            if speed_kmh is not None:
                route.speed_kmh = float(speed_kmh)

            if interval_s is not None:
                route.interval_s = float(interval_s)

            if pause_s is not None:
                route.pause_s = float(pause_s)

            if from_current is not None:
                route.from_current = bool(from_current)

            route.save()

            if waypoints is not None:
                if not isinstance(waypoints, list) or len(waypoints) < 2:
                    return JsonResponse({"error": "need at least 2 waypoints"}, status=400)

                route.waypoints.all().delete()

                waypoint_rows = []
                for idx, wp in enumerate(waypoints):
                    lat = wp.get("lat")
                    lng = wp.get("lng")
                    text = wp.get("text") or ""

                    if lat is None or lng is None:
                        raise ValueError("each waypoint must include lat and lng")

                    waypoint_rows.append(
                        SavedRouteWaypoint(
                            saved_route=route,
                            order_index=idx,
                            lat=float(lat),
                            lng=float(lng),
                            text=text,
                        )
                    )

                SavedRouteWaypoint.objects.bulk_create(waypoint_rows)

        route = SavedRoute.objects.prefetch_related("waypoints").get(id=route.id)

        return JsonResponse(
            {
                "ok": True,
                "route": _serialize_saved_route(route, include_waypoints=True),
            }
        )
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except Exception as e:
        log.exception(f"update saved route failed err={e}")
        return JsonResponse({"error": "failed to update route"}, status=500)

@require_http_methods(["GET"])
def auth_desktop_start(request):
    rid = _request_id(request)

    if not settings.GOOGLE_CLIENT_ID:
        return JsonResponse({"error": "GOOGLE_CLIENT_ID is not configured", "request_id": rid}, status=500)
    if not getattr(settings, "GOOGLE_CLIENT_SECRET", ""):
        return JsonResponse({"error": "GOOGLE_CLIENT_SECRET is not configured", "request_id": rid}, status=500)

    redirect_uri = request.build_absolute_uri("/api/auth/desktop/callback")

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }

    return HttpResponseRedirect(
        "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    )


@require_http_methods(["GET"])
def auth_desktop_callback(request):
    rid = _request_id(request)
    code = request.GET.get("code")

    if not code:
        return JsonResponse({"error": "missing code", "request_id": rid}, status=400)

    redirect_uri = request.build_absolute_uri("/api/auth/desktop/callback")

    try:
        token_res = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
    except Exception as e:
        log.exception(f"[{rid}] token exchange failed err={e}")
        return JsonResponse({"error": "token exchange failed", "request_id": rid}, status=502)

    if not token_res.ok:
        return JsonResponse({"error": "token exchange failed", "request_id": rid}, status=401)

    token_data = token_res.json()
    id_token_str = token_data.get("id_token")
    if not id_token_str:
        return JsonResponse({"error": "missing id_token", "request_id": rid}, status=401)

    try:
        idinfo = id_token.verify_oauth2_token(
            id_token_str,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except Exception as e:
        log.exception(f"[{rid}] desktop google token verify failed err={e}")
        return JsonResponse({"error": "invalid Google ID token", "request_id": rid}, status=401)

    issuer = idinfo.get("iss")
    if issuer not in ["accounts.google.com", "https://accounts.google.com"]:
        return JsonResponse({"error": "invalid issuer", "request_id": rid}, status=401)

    google_sub = idinfo.get("sub")
    email = idinfo.get("email")
    name = idinfo.get("name")
    picture = idinfo.get("picture")
    email_verified = bool(idinfo.get("email_verified"))

    if not google_sub or not email:
        return JsonResponse({"error": "missing required Google user fields", "request_id": rid}, status=400)

    try:
        db_user, created = AppUser.objects.update_or_create(
            google_sub=google_sub,
            defaults={
                "email": email,
                "name": name,
                "picture_url": picture,
                "email_verified": email_verified,
                "is_active": True,
            },
        )
    except Exception as e:
        log.exception(f"[{rid}] failed to save user err={e}")
        return JsonResponse({"error": "failed to save user", "request_id": rid}, status=500)

    login_ticket = DesktopLoginTicket.issue(db_user, ttl_seconds=300)

    log.info(f"[{rid}] desktop oauth success email={db_user.email} created={created}")

    return HttpResponseRedirect(
        f"http://127.0.0.1:9100/auth/complete?ticket={login_ticket.ticket}"
    )


@csrf_exempt
@require_http_methods(["POST"])
def auth_desktop_exchange(request):
    rid = _request_id(request)

    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return JsonResponse({"error": "invalid json", "request_id": rid}, status=400)

    ticket_value = body.get("ticket")
    if not ticket_value:
        return JsonResponse({"error": "missing ticket", "request_id": rid}, status=400)

    try:
        login_ticket = DesktopLoginTicket.objects.select_related("user").get(ticket=ticket_value)
    except DesktopLoginTicket.DoesNotExist:
        return JsonResponse({"error": "ticket not found", "request_id": rid}, status=404)

    if not login_ticket.is_valid:
        return JsonResponse({"error": "ticket expired or consumed", "request_id": rid}, status=401)

    db_user = login_ticket.user
    session_user = _serialize_user(db_user)

    request.session["authenticated"] = True
    request.session["user_id"] = db_user.id
    request.session["user"] = session_user
    request.session.set_expiry(60 * 60 * 24 * 7)

    login_ticket.consumed_at = timezone.now()
    login_ticket.save(update_fields=["consumed_at"])

    return JsonResponse({
        "authenticated": True,
        "user": session_user,
    })