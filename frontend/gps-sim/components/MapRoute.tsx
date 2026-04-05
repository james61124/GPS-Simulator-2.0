// app/components/MapRoute.tsx
"use client"

import { useEffect, useMemo, useRef } from "react"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import type { LatLng } from "./Map"

import "leaflet-defaulticon-compatibility"
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css"

export type Waypoint = {
  id: string
  lat: number
  lng: number
}

type Props = {
  waypoints: Waypoint[]
  pendingPoint?: LatLng | null
  routeLine?: LatLng[]
  onPickPending: (p: LatLng) => void
  onDragWaypoint: (id: string, p: LatLng) => void
  onRightClickWaypoint?: (id: string) => void
  className?: string
}

function toLatLng(p: { lat: number; lng: number }): L.LatLngExpression {
  return [p.lat, p.lng]
}

function makePendingIcon() {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `
      <div style="
        width:18px;height:18px;border-radius:999px;
        background:#0f172a; box-shadow: 0 0 0 3px rgba(255,255,255,0.9), 0 6px 16px rgba(15,23,42,0.25);
      "></div>
    `,
  })
}

function makeWaypointIcon(label: string) {
  return L.divIcon({
    className: "",
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    html: `
      <div style="position:relative; width:28px; height:34px;">
        <div style="
          position:absolute; left:50%; top:0;
          transform:translateX(-50%);
          width:24px;height:24px;border-radius:999px;
          background:#ffffff;
          border:2px solid #0f172a;
          display:flex;align-items:center;justify-content:center;
          font: 700 12px/1 ui-sans-serif, system-ui, -apple-system;
          color:#0f172a;
          box-shadow: 0 6px 16px rgba(15,23,42,0.18);
        ">${label}</div>
        <div style="
          position:absolute; left:50%; bottom:1px;
          transform:translateX(-50%) rotate(45deg);
          width:10px; height:10px;
          background:#ffffff;
          border-right:2px solid #0f172a;
          border-bottom:2px solid #0f172a;
        "></div>
      </div>
    `,
  })
}

export default function MapRoute({
  waypoints,
  pendingPoint,
  routeLine,
  onPickPending,
  onDragWaypoint,
  onRightClickWaypoint,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  const pendingMarkerRef = useRef<L.Marker | null>(null)
  const markersByIdRef = useRef<Map<string, L.Marker>>(new Map())

  const routeRef = useRef<L.Polyline | null>(null)
  const wpRef = useRef<L.Polyline | null>(null)

  const pendingIcon = useMemo(() => makePendingIcon(), [])
  const wpIcons = useMemo(() => {
    const m = new Map<string, L.DivIcon>()
    waypoints.forEach((w, idx) => m.set(w.id, makeWaypointIcon(String(idx + 1))))
    return m
  }, [waypoints])

  useEffect(() => {
    if (!hostRef.current) return
    if (mapRef.current) return

    const initCenter: LatLng =
      pendingPoint ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : { lat: 37.7749, lng: -122.4194 })

    const map = L.map(hostRef.current, { zoomControl: false, scrollWheelZoom: true }).setView(toLatLng(initCenter), 13)
    L.control.zoom({ position: "bottomright" }).addTo(map)

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map)

    map.on("click", (e: any) => {
      onPickPending({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null

      pendingMarkerRef.current = null
      markersByIdRef.current.clear()

      if (routeRef.current) routeRef.current = null
      if (wpRef.current) wpRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pending marker
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!pendingPoint) {
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.remove()
        pendingMarkerRef.current = null
      }
      return
    }

    if (!pendingMarkerRef.current) {
      pendingMarkerRef.current = L.marker(toLatLng(pendingPoint), {
        draggable: false,
        icon: pendingIcon,
        zIndexOffset: 1000,
      }).addTo(map)
    } else {
      pendingMarkerRef.current.setLatLng(toLatLng(pendingPoint))
    }

    map.panTo(toLatLng(pendingPoint), { animate: true })
  }, [pendingPoint, pendingIcon])

  // waypoint markers (stable by id)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const existing = markersByIdRef.current

    // remove markers for deleted ids
    for (const [id, m] of Array.from(existing.entries())) {
      if (!waypoints.some((w) => w.id === id)) {
        m.remove()
        existing.delete(id)
      }
    }

    // add/update markers for current waypoints
    waypoints.forEach((w, idx) => {
      const icon = wpIcons.get(w.id) ?? makeWaypointIcon(String(idx + 1))
      const has = existing.get(w.id)

      if (!has) {
        const m = L.marker(toLatLng(w), { draggable: true, icon }).addTo(map)

        m.on("dragend", () => {
          const ll = m.getLatLng()
          onDragWaypoint(w.id, { lat: ll.lat, lng: ll.lng })
        })

        m.on("contextmenu", () => {
          onRightClickWaypoint?.(w.id)
        })

        existing.set(w.id, m)
      } else {
        has.setLatLng(toLatLng(w))
        has.setIcon(icon)
      }
    })

    // optional: dashed straight line between waypoints as reference
    if (wpRef.current) {
      wpRef.current.remove()
      wpRef.current = null
    }
  }, [waypoints, wpIcons, onDragWaypoint, onRightClickWaypoint])

  // route preview polyline (real road route from backend)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (routeRef.current) routeRef.current.remove()

    if (routeLine && routeLine.length >= 2) {
      routeRef.current = L.polyline(routeLine.map(toLatLng)).addTo(map)
      map.fitBounds(routeRef.current.getBounds().pad(0.1))
    } else {
      routeRef.current = null
      // if no route yet, fit to waypoints
      if (waypoints.length >= 2) {
        const tmp = L.polyline(waypoints.map(toLatLng))
        map.fitBounds(tmp.getBounds().pad(0.15))
        tmp.remove()
      } else if (waypoints.length === 1) {
        map.panTo(toLatLng(waypoints[0]))
      }
    }
  }, [routeLine, waypoints])

  return <div ref={hostRef} className={className ?? "h-[360px] w-full"} />
}