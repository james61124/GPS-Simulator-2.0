"use client"

import "leaflet-defaulticon-compatibility"
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css"
import "leaflet/dist/leaflet.css"
import { useEffect, useRef } from "react"
import "leaflet/dist/leaflet.css"
import L from "leaflet"

export type LatLng = { lat: number; lng: number }

function isFiniteNum(x: any) {
  return typeof x === "number" && Number.isFinite(x)
}

type Props = {
  value: LatLng
  onPick: (next: LatLng) => void
  onCommit?: (next: LatLng) => void | Promise<void>
  disabled?: boolean
  zoom?: number
  className?: string
}

export default function Map({
  value,
  onPick,
  onCommit,
  disabled = false,
  zoom = 13,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    if (mapRef.current) return

    const map = L.map(hostRef.current, {
      zoomControl: false,
      scrollWheelZoom: true,
      dragging: !disabled,
      doubleClickZoom: false,
      boxZoom: !disabled,
      keyboard: !disabled,
    }).setView([value.lat, value.lng], zoom)

    L.control.zoom({ position: "bottomright" }).addTo(map)

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map)

    const marker = L.marker([value.lat, value.lng], {
      draggable: !disabled,
    }).addTo(map)

    marker.on("dragend", async () => {
      const p = marker.getLatLng()
      const next = { lat: p.lat, lng: p.lng }
      onPick(next)
      await onCommit?.(next)
    })
    
    map.on("click", async (e: any) => {
      const next = { lat: e.latlng.lat, lng: e.latlng.lng }
      onPick(next)
      await onCommit?.(next)
    })

    mapRef.current = map
    markerRef.current = marker

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return
    if (!isFiniteNum(value.lat) || !isFiniteNum(value.lng)) return

    marker.setLatLng([value.lat, value.lng])
    map.panTo([value.lat, value.lng], { animate: true })
  }, [value.lat, value.lng])

  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return

    if (disabled) {
      map.dragging.disable()
      map.doubleClickZoom.disable()
      map.boxZoom.disable()
      map.keyboard.disable()
      marker.dragging?.disable()
      return
    }

    map.dragging.enable()
    map.doubleClickZoom.enable()
    map.boxZoom.enable()
    map.keyboard.enable()
    marker.dragging?.enable()
  }, [disabled])

  return <div ref={hostRef} className={className ?? "h-[360px] w-full"} />
}