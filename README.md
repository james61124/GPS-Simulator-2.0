setup .env

frontend:

```
cd frontend/gps-sim
npm install
npm run dev
```


backend:

1. 
```
cd backend
sudo uvicorn device_service.main:app --host 127.0.0.1 --port 9100
```


2. 
```
cd backend/gpsSimulator
python3 manage.py runserver 0.0.0.0:8000
```

dashboard:

localhost:3000
