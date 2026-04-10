// app/components/SinglePanel.tsx
"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { resolveTextToPoint, type LatLng } from "@/lib/geo"
import WorkspaceTopLeft from "@/components/WorkspaceTopLeft"
import { callLocal } from "@/lib/api"

const MapView = dynamic(() => import("./Map"), { ssr: false })

export default function SinglePanel({
  connected,
  status,
  setStatus,
  mode,
  onModeChange,
}: {
  connected: boolean
  status: string
  setStatus: (s: string) => void
  mode: "single" | "route"
  onModeChange: (nextMode: "single" | "route") => void
}) {
  const [loc, setLoc] = useState<LatLng>({ lat: 37.7749, lng: -122.4194 })
  const [query, setQuery] = useState("")
  const [resolving, setResolving] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [busySet, setBusySet] = useState(false)

  const [panelTab, setPanelTab] = useState<"current" | "saved">("current")

  async function resolveLocation() {
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
      setStatus("Location resolved")
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

    setBusySet(true)
    setStatus("")

    try {
      await callLocal<any>("/api/update_location", {
        method: "POST",
        body: JSON.stringify({ lat: loc.lat, lng: loc.lng }),
      })

      await callLocal<any>("/api/simulate_location", { method: "POST" })

      setSimulating(true)
      setStatus("Simulating")
    } catch (e: any) {
      setSimulating(false)
      setStatus(e?.message ?? "Failed to start simulation")
    } finally {
      setBusySet(false)
    }
  }

  async function stopSim() {
    setStatus("")
    try {
      await callLocal<any>("/api/location/stop", { method: "POST" })
      setSimulating(false)
      setStatus("Stopped")
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to stop")
    }
  }

  return (
    <div className="mt-6">
      <div className="relative overflow-hidden rounded-[32px] border border-[#dfe7dc] bg-[#f6f4ea] shadow-sm">
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: "radial-gradient(#b7c7b0 2px, transparent 2px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative h-[78vh] min-h-[720px]">
          <MapView value={loc} onPick={(next: LatLng) => setLoc(next)} className="h-full w-full" />

          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#f6f4ea]/90 via-[#f6f4ea]/35 to-transparent" />

          <WorkspaceTopLeft
            mode={mode}
            onModeChange={onModeChange}
            title="📍 Single mode"
            subtitle="Click map or search a place, then set location"
            statusLabel={simulating ? "Simulating" : "Idle"}
            statusTone={simulating ? "success" : "neutral"}
          />

          <div className="pointer-events-none absolute left-5 bottom-5 z-[500] rounded-2xl bg-white/88 px-4 py-3 shadow-sm backdrop-blur">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current point</div>
            <div className="mt-1 font-mono text-sm text-slate-900">
              {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
            </div>
          </div>

          <div className="absolute right-5 top-5 z-[500] w-[380px] max-w-[calc(100%-2.5rem)]">
            <div className="overflow-hidden rounded-[28px] border border-[#dbe5d4] bg-white/92 shadow-[0_12px_40px_rgba(15,23,42,0.12)] backdrop-blur-md">
              <div className="border-b border-[#edf2e8] px-4 pt-4">
                <div className="flex items-center rounded-full bg-[#f3f6ee] p-1">
                  <button
                    onClick={() => setPanelTab("current")}
                    className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                      panelTab === "current"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    📍 Current
                  </button>

                  <button
                    onClick={() => setPanelTab("saved")}
                    className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                      panelTab === "saved"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    🌱 Saved
                  </button>
                </div>

                <div className="px-1 pb-4 pt-3">
                  {panelTab === "current" ? (
                    <div className="text-xs text-slate-500">
                      Pick a point, resolve address, then send location to device
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Saved places will live here
                    </div>
                  )}
                </div>
              </div>

              <div className="max-h-[calc(78vh-92px)] overflow-y-auto px-4 py-4">
                {panelTab === "current" ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Pick a point or search a place</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Click map or enter coordinates / address, then press Start to update device location
                      </div>
                    </div>

                    <div className="space-y-3">
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="(37.7749, -122.4194) or 1600 Amphitheatre Parkway"
                        className="w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
                      />

                      <button
                        onClick={resolveLocation}
                        disabled={resolving}
                        className="w-full rounded-full bg-[#7bc47f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
                      >
                        {resolving ? "Finding…" : "Search"}
                      </button>
                    </div>

                    <div className="h-px bg-[#e7eee1]" />

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Current location
                      </div>

                      <div className="rounded-2xl bg-white px-4 py-3 text-sm font-mono text-slate-900 shadow-sm">
                        {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
                      </div>
                    </div>

                    <div className="h-px bg-[#e7eee1]" />

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={startSim}
                        disabled={!connected || busySet || resolving}
                        className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
                      >
                        {busySet ? "Starting…" : simulating ? "Running" : "Start"}
                      </button>

                      <button
                        onClick={stopSim}
                        disabled={!connected}
                        className="rounded-full bg-[#f1d98c] px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:brightness-95 disabled:opacity-50"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                ) : (
                  <section className="rounded-[24px] border border-dashed border-[#d9e5cf] bg-[#fbfcf8] p-6 text-center">
                    <div className="text-sm font-semibold text-slate-900">🌱 Saved places coming soon</div>
                    <div className="mt-2 text-xs text-slate-500">
                      This tab is reserved for saved single locations, search, filter, and one-click apply
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}