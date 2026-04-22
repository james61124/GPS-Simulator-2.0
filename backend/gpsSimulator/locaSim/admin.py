from django.contrib import admin
from .models import (
    AppUser,
    DesktopLoginTicket,
    SavedRoute,
    SavedRouteWaypoint,
)


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
    list_filter = ("email_verified", "is_active", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(DesktopLoginTicket)
class DesktopLoginTicketAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "ticket",
        "user",
        "created_at",
        "expires_at",
        "consumed_at",
        "is_valid_display",
    )
    search_fields = ("ticket", "user__email", "user__google_sub")
    list_filter = ("created_at", "expires_at", "consumed_at")
    readonly_fields = ("created_at", "is_valid_display")
    autocomplete_fields = ("user",)
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Is valid")
    def is_valid_display(self, obj):
        return obj.is_valid


class SavedRouteWaypointInline(admin.TabularInline):
    model = SavedRouteWaypoint
    extra = 0
    fields = ("order_index", "lat", "lng", "text", "created_at")
    readonly_fields = ("created_at",)
    ordering = ("order_index",)


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
    search_fields = ("name", "user__email", "user__google_sub")
    list_filter = ("loop", "from_current", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("user",)
    inlines = [SavedRouteWaypointInline]
    ordering = ("-updated_at",)


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
    search_fields = (
        "saved_route__name",
        "saved_route__user__email",
        "text",
    )
    list_filter = ("created_at",)
    readonly_fields = ("created_at",)
    autocomplete_fields = ("saved_route",)
    ordering = ("saved_route", "order_index")