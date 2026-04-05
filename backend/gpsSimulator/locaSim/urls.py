from django.urls import path
from . import views

urlpatterns = [
    path("devices", views.devices),
    path("connect", views.connect),
    path("update_location", views.location_update),
    path("simulate_location", views.location_simulate),
    path("location/stop", views.location_stop),
    path("location/route/preview", views.route_preview),
    path("location/route/simulate", views.location_route_simulate),
    path("location/route/stop", views.location_route_stop),

    path("auth/google", views.auth_google),
    path("auth/session", views.auth_session),
    path("auth/logout", views.auth_logout),
]