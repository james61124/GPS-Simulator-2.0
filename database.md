# Database Schema

## users

Stores Google authenticated users

| column | type | note |
|---|---|---|
| id | bigint | PK |
| google_sub | varchar | unique |
| email | varchar | unique |
| name | varchar | |
| picture_url | text | |
| email_verified | bool | |
| is_active | bool | |
| created_at | datetime | |
| updated_at | datetime | |

---

## Notes

- google_sub is primary identity
- managed by Django ORM
- created/updated on login

---

## Migration

~~~bash
python manage.py makemigrations
python manage.py migrate
~~~