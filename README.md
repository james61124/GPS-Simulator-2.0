# SprytePath 🌱

SprytePath is a hybrid GPS simulation system designed for route-based location testing and device control.

Instead of manually setting coordinates, SprytePath lets you:

- 🌱 Plant waypoints  
- 🌿 Grow routes  
- 🚶 Simulate movement  

---

## 📦 Requirements

Before getting started, make sure you have:

- Docker
- Uvicorn
- Google Maps API Key (there is a free quota)

To obtain the Google Maps API key:

1. Go to Google Cloud
2. Enable the following APIs:
   - Geocoding API
   - Directions API
3. Create an API key

---

## 🔐 Google OAuth Setup

### 1. Configure OAuth Consent Screen

Go to Google Cloud → OAuth consent screen:

- User Type: External  
- App Name: any (e.g., GPS Simulator)  
- User Support Email: your email  
- Developer Contact Information: your email  
- Test Users: add your email  

---

### 2. Create OAuth Credentials

Go to Credentials → Create Credentials → OAuth Client ID:

- Application Type: Web application  
- Authorized JavaScript origins:
  ```
  http://localhost:3000
  ```
- Authorized redirect URIs:
  ```
  http://localhost:3000
  ```

After creation, you will get:

```
Client ID: xxxxx.apps.googleusercontent.com
```

---

## 🔑 Environment Setup

Rename the following files:

- `backend/device_service/.env.example` → `.env`
- `backend/gpsSimulator/.env.example` → `.env`
- `.env.example` → `.env`

Then fill in:

### Google Maps API Key
- `backend/device_service/.env`
  ```
  GOOGLE_MAPS_API_KEY=your_api_key
  ```

### Google OAuth Client ID
- `backend/gpsSimulator/.env`
  ```
  GOOGLE_CLIENT_ID=your_client_id
  ```

- root `.env`
  ```
  NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_client_id
  GOOGLE_CLIENT_ID=your_client_id
  ```

---

## ⚙️ Setup & Run

### 1. Start infrastructure (Docker)

~~~
sudo docker compose --env-file .env up -d
~~~

This starts:
- MariaDB  
- Django backend  
- Next.js frontend  
- Nginx  

---

### 2. Start local device agent

Open another terminal:

~~~
cd backend
sudo uvicorn device_service.main:app --host 127.0.0.1 --port 9100
~~~

---

### 3. Open the app

~~~
http://localhost:3000
~~~

---

## 🧠 Architecture Overview

SprytePath is **not a pure SaaS application**. It is a hybrid system combining cloud services with a local device agent.

~~~
Frontend (Next.js UI)
   ├── Calls Django (cloud backend)
   └── Calls Local Agent (device control)

Django (Cloud Backend)
   ├── Authentication (Google OAuth + session)
   ├── Route storage (MariaDB)
   └── REST APIs

FastAPI (Local Device Agent)
   ├── Device scan / connect
   ├── iOS tunnel management
   └── Location simulation (single / route)
~~~

---

## 🧩 Tech Stack

### Frontend
- Next.js (App Router)
- Tailwind CSS
- Leaflet (map rendering)

### Backend (Cloud)
- Django
- MariaDB (Docker)
- Session-based authentication (no JWT)

### Local Agent
- FastAPI
- pymobiledevice3 (iOS control)

### Infrastructure
- Docker + docker-compose
- Nginx (reverse proxy)

---

## 🔐 Authentication

SprytePath uses **session-based authentication (NOT JWT)**

~~~
1. User logs in with Google (frontend)
2. ID token sent to Django
3. Django verifies and creates session
4. Browser stores sessionid cookie
5. All requests use credentials: include
~~~

---

## 🗄 Database Schema (Core)

### users
Stores authenticated users

### saved_routes
- id  
- user_id  
- name  
- loop  
- speed_kmh  
- interval_s  
- pause_s  
- from_current  
- created_at  
- updated_at  

### saved_route_waypoints
- id  
- saved_route_id  
- order_index  
- lat  
- lng  
- text  

---

## 🚀 Features

### 📍 Single Mode
- Click map to pick location  
- Search address / coordinates  
- Start / stop GPS simulation  
- (Planned) Saved places  

---

### 🛣 Route Mode
- Add waypoints (map or search)  
- Drag-and-drop reorder  
- Route preview  
- Simulate walking routes  
- Save / replace routes  
- Apply saved routes  

---

## 🖥 UI Design Principles

- Map-first interface (full screen map)
- Overlay panel (not side-by-side layout)
- Minimal UI (no heavy cards)
- Flow-based interaction instead of dashboard blocks

## 🔌 API Overview

### Django (Cloud)

~~~
POST   /api/auth/google
GET    /api/auth/session
POST   /api/auth/logout

GET    /api/saved-routes
POST   /api/saved-routes
GET    /api/saved-routes/:id
PUT    /api/saved-routes/:id
DELETE /api/saved-routes/:id
~~~

---

### FastAPI (Local Agent)

~~~
GET  /devices
POST /connect

POST /location/update
POST /location/simulate
POST /location/stop

POST /location/route/preview
POST /location/route/simulate
POST /location/route/stop
~~~

---

## 🔄 Data Flow

### Single Mode

~~~
User picks location (map or search)
→ Frontend updates state

Start
→ POST /location/update
→ POST /location/simulate
~~~

---

### Route Mode

~~~
Add waypoints
→ Build route preview

Start
→ POST /location/route/simulate

Stop
→ POST /location/route/stop
~~~

---

## 📦 Docker Notes

MariaDB uses a named volume:

~~~
mariadb_data:/var/lib/mysql
~~~

This ensures:
- Data persists across container restarts  
- Safe schema migrations via Django  

---

## 🧪 Development Notes

Frontend uses volume mount:

~~~
volumes:
  - ./frontend:/app
~~~

→ No rebuild needed for UI changes

---

If container has no bash:

~~~
docker exec -it frontend sh
~~~

---

## 🎯 Future Plans

- Desktop app via Tauri  
- Bundle FastAPI as local agent binary  
- Signed distribution (macOS / Windows)  
- Multi-device support  
- Route sharing  
- Analytics & history  

---

## 🧠 Core Idea

SprytePath is built around a simple mental model:

~~~
Plant points → Grow routes → Simulate movement
~~~

Instead of thinking in coordinates, users interact with location as a natural flow.