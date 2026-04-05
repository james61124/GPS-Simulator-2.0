import json
import uuid
import logging
import httpx

from django.http import JsonResponse, HttpResponseNotAllowed, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from django.views.decorators.http import require_http_methods

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from .models import AppUser

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