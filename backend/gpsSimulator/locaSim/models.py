from django.db import models


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