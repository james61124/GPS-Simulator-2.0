from functools import wraps
from django.http import JsonResponse
from .models import AppUser


def app_login_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.session.get("authenticated"):
            return JsonResponse({"error": "unauthorized"}, status=401)

        user_id = request.session.get("user_id")
        if not user_id:
            return JsonResponse({"error": "unauthorized"}, status=401)

        try:
            request.app_user = AppUser.objects.get(id=user_id, is_active=True)
        except AppUser.DoesNotExist:
            return JsonResponse({"error": "unauthorized"}, status=401)

        return view_func(request, *args, **kwargs)

    return wrapper