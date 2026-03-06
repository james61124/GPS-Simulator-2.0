import json
import uuid
import logging
import httpx

from django.http import JsonResponse, HttpResponseNotAllowed, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

log = logging.getLogger("walksim.api")

DEVICE_URL = getattr(settings, "DEVICE_SERVICE_URL", "http://127.0.0.1:9100")
DEVICE_SVC = "http://127.0.0.1:9100"
FASTAPI_BASE = "http://127.0.0.1:9100"
DEVICE_BASE = "http://127.0.0.1:9100"


def _request_id(request) -> str:
    return request.headers.get("X-Request-Id") or uuid.uuid4().hex[:8]


def _proxy(method: str, path: str, rid: str, payload: dict | None = None):
    url = f"{DEVICE_SVC}{path}"
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
            r = client.post(f"{FASTAPI_BASE}/location/route/preview", content=body, headers={"Content-Type": "application/json"})
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
            r = c.post(f"{DEVICE_BASE}/location/route/simulate", json=payload, headers=_forward_headers(request))
        return JsonResponse(r.json(), status=r.status_code)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=502)

def _forward_headers(request):
    headers = {}

    # 保留 request id（你 FastAPI 有 middleware 用這個）
    if "HTTP_X_REQUEST_ID" in request.META:
        headers["x-request-id"] = request.META["HTTP_X_REQUEST_ID"]

    # 轉發 Content-Type（通常 POST 需要）
    if "CONTENT_TYPE" in request.META:
        headers["Content-Type"] = request.META["CONTENT_TYPE"]

    return headers

@csrf_exempt
def location_route_stop(request):
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    try:
        with httpx.Client(timeout=30.0) as c:
            r = c.post(f"{DEVICE_BASE}/location/route/stop", headers=_forward_headers(request))
        return JsonResponse(r.json(), status=r.status_code)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=502)
