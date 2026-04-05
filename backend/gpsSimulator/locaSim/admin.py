from django.contrib import admin
from .models import AppUser


@admin.register(AppUser)
class AppUserAdmin(admin.ModelAdmin):
    list_display = ("id", "email", "google_sub", "is_active", "created_at")
    search_fields = ("email", "google_sub")
    list_filter = ("is_active", "email_verified", "created_at")