// app/components/SinglePanel.tsx
"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { callBackend } from "@/app/lib/api"
import { resolveTextToPoint, type LatLng } from "@/app/lib/geo"

const MapView = dynamic(() => import("./Map"), { ssr: false })

export default function SinglePanel({
  connected,
  status,
  setStatus,
}: {
  connected: boolean
  status: string
  setStatus: (s: string) => void
}) {
  const [loc, setLoc] = useState<LatLng>({ lat: 37.7749, lng: -122.4194 })
  const [query, setQuery] = useState("")
  const [resolving, setResolving] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [busySet, setBusySet] = useState(false)

  async function setLocationOnDevice(next: LatLng) {
    if (!connected) {
      setStatus("Please connect device first")
      return
    }
    setBusySet(true)
    setStatus("")
    try {
      await callBackend<any>("/api/update_location", {
        method: "POST",
        body: JSON.stringify({ lat: next.lat, lng: next.lng }),
      })
      await callBackend<any>("/api/simulate_location", { method: "POST" })
      setStatus("Location updated")
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to update location")
    } finally {
      setBusySet(false)
    }
  }

  async function resolveAndSetLocation() {
    const input = query.trim()
    if (!input) {
      setStatus("Please enter '(lat, lng)' or an address")
      return
    }
    setResolving(true)
    setStatus("")
    try {
      const next = await resolveTextToPoint(input)
      if (!next) {
        setStatus("Cannot find location, try '(lat, lng)' or a more specific address")
        return
      }
      setLoc(next)
      await setLocationOnDevice(next)
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to resolve location")
    } finally {
      setResolving(false)
    }
  }

  async function startSim() {
    if (!connected) {
      setStatus("Please connect device first")
      return
    }
    setSimulating(true)
    setStatus("")
    try {
      await callBackend<any>("/api/simulate_location", { method: "POST" })
      setStatus("Simulating")
    } catch (e: any) {
      setSimulating(false)
      setStatus(e?.message ?? "Failed to start simulation")
    }
  }

  async function stopSim() {
    setStatus("")
    try {
      await callBackend<any>("/api/location/stop", { method: "POST" })
      setSimulating(false)
      setStatus("Stopped")
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to stop")
    }
  }

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-5">
      <div className="md:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between px-2 pb-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Map</div>
            <div className="text-xs text-slate-500">Click to pick coordinate then Set location</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={startSim}
              disabled={!connected || simulating}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {simulating ? "Running" : "Start"}
            </button>
            <button
              onClick={stopSim}
              disabled={!connected}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200">
          <MapView value={loc} onPick={(next: LatLng) => setLoc(next)} className="h-[360px] w-full" />
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/90 px-3 py-2 text-xs text-slate-700 shadow-sm">
            <div className="font-medium text-slate-900">Current</div>
            <div className="mt-1 font-mono">
              {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
            </div>
          </div>
        </div>
      </div>

      <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Location Controls</div>
        <div className="mt-1 text-xs text-slate-500">Enter “(lat, lng)” or address then Set location</div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">Coordinate or Address</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="(37.7749, -122.4194) or 1600 Amphitheatre Parkway"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
            />
          </div>

          <button
            onClick={resolveAndSetLocation}
            disabled={busySet || resolving}
            className="mt-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {resolving ? "Finding…" : busySet ? "Sending…" : "Set location"}
          </button>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            <div className="font-semibold text-slate-900">API</div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed">
              POST /api/update_location {"{lat,lng}"} <br />
              POST /api/simulate_location <br />
              POST /api/stop_location
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}