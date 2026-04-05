from django.contrib import admin
from .models import AppUser, SavedRoute, SavedRouteWaypoint


class SavedRouteWaypointInline(admin.TabularInline):
    model = SavedRouteWaypoint
    extra = 0
    fields = ("order_index", "lat", "lng", "text", "created_at")
    readonly_fields = ("created_at",)
    ordering = ("order_index",)


@admin.register(AppUser)
class AppUserAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "email",
        "name",
        "google_sub",
        "email_verified",
        "is_active",
        "created_at",
        "updated_at",
    )
    search_fields = ("email", "name", "google_sub")
    list_filter = ("email_verified", "is_active", "created_at")
    readonly_fields = ("created_at", "updated_at")


@admin.register(SavedRoute)
class SavedRouteAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "user",
        "loop",
        "speed_kmh",
        "interval_s",
        "pause_s",
        "from_current",
        "created_at",
        "updated_at",
    )
    search_fields = ("name", "user__email", "user__name")
    list_filter = ("loop", "from_current", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")
    inlines = [SavedRouteWaypointInline]


@admin.register(SavedRouteWaypoint)
class SavedRouteWaypointAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "saved_route",
        "order_index",
        "lat",
        "lng",
        "text",
        "created_at",
    )
    search_fields = ("saved_route__name", "saved_route__user__email", "text")
    list_filter = ("created_at",)
    readonly_fields = ("created_at",)