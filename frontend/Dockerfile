FROM node:20-bookworm-slim

WORKDIR /app/gps-sim

COPY gps-sim/package*.json ./
RUN npm install

COPY gps-sim ./

EXPOSE 3000