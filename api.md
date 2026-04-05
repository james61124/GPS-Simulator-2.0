# API Documentation

## Overview

This project uses:

- Next.js frontend
- Django backend
- FastAPI device service
- MariaDB
- Session-based authentication

---

## POST /api/auth/google

~~~json
{
  "idToken": "google-id-token"
}
~~~

~~~json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "sub": "xxx",
    "email": "test@gmail.com"
  },
  "created": true
}
~~~

---

## GET /api/auth/session

~~~json
{
  "authenticated": true,
  "user": { ... }
}
~~~

---

## POST /api/auth/logout

~~~json
{
  "ok": true
}
~~~

---

## Device APIs

- GET /api/devices
- POST /api/connect
- POST /api/location/update
- POST /api/location/simulate
- POST /api/location/stop
- POST /api/location/route/preview
- POST /api/location/route/simulate
- POST /api/location/route/stop

All proxied to FastAPI device service