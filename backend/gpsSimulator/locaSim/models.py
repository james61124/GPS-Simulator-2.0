from django.db import models
import secrets
from datetime import timedelta
from django.utils import timezone

class DesktopLoginTicket(models.Model):
    ticket = models.CharField(max_length=128, unique=True, db_index=True)
    user = models.ForeignKey("AppUser", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, user, ttl_seconds=300):
        return cls.objects.create(
            ticket=secrets.token_urlsafe(48),
            user=user,
            expires_at=timezone.now() + timedelta(seconds=ttl_seconds),
        )

    @property
    def is_valid(self):
        return self.consumed_at is None and timezone.now() < self.expires_at


class AppUser(models.Model):
    google_sub = models.CharField(max_length=255, unique=True)
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255, blank=True, null=True)
    picture_url = models.TextField(blank=True, null=True)
    email_verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users"

    def __str__(self):
        return f"{self.email} ({self.google_sub})"


class SavedRoute(models.Model):
    user = models.ForeignKey(
        AppUser,
        on_delete=models.CASCADE,
        related_name="saved_routes",
    )
    name = models.CharField(max_length=255)
    loop = models.BooleanField(default=False)
    speed_kmh = models.FloatField(default=18.0)
    interval_s = models.FloatField(default=0.5)
    pause_s = models.FloatField(default=0.0)
    from_current = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "saved_routes"
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.name} - {self.user.email}"


class SavedRouteWaypoint(models.Model):
    saved_route = models.ForeignKey(
        SavedRoute,
        on_delete=models.CASCADE,
        related_name="waypoints",
    )
    order_index = models.PositiveIntegerField()
    lat = models.FloatField()
    lng = models.FloatField()
    text = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "saved_route_waypoints"
        ordering = ["order_index"]
        unique_together = ("saved_route", "order_index")

    def __str__(self):
        return f"Route#{self.saved_route_id} waypoint#{self.order_index}"