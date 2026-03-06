// app/components/RoutePanel.tsx
"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { callBackend } from "@/app/lib/api"
import { resolveTextToPoint, type LatLng } from "@/app/lib/geo"
import type { Waypoint as MapWaypoint } from "@/app/components/MapRoute"

const MapRouteView = dynamic(() => import("./MapRoute"), { ssr: false })

type RoutePreviewResponse = {
  status: string
  full_route?: LatLng[]
  dense?: LatLng[]
}

type Waypoint = { id: string; lat: number; lng: number; text: string }

export default function RoutePanel({
  connected,
  status,
  setStatus,
}: {
  connected: boolean
  status: string
  setStatus: (s: string) => void
}) {
  const [pendingPoint, setPendingPoint] = useState<LatLng | null>(null)
  const [pendingText, setPendingText] = useState<string>("")
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [routeLine, setRouteLine] = useState<LatLng[] | null>(null)

  const [routeBusy, setRouteBusy] = useState(false)
  const [routeRunning, setRouteRunning] = useState(false)

  const [speedKmh, setSpeedKmh] = useState<number>(18)
  const [intervalS, setIntervalS] = useState<number>(0.5)
  const [pauseS, setPauseS] = useState<number>(0.0)
  const [loop, setLoop] = useState<boolean>(false)
  const [fromCurrent, setFromCurrent] = useState<boolean>(false)

  const newId = () => crypto.randomUUID()

  function routePointsPayload() {
    return waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))
  }

  function clearRoute() {
    setWaypoints([])
    setPendingPoint(null)
    setPendingText("")
    setRouteLine(null)
    setRouteRunning(false)
  }

  async function routePreview() {
    if (waypoints.length < 2) {
      setStatus("Need at least 2 waypoints")
      return
    }
    setRouteBusy(true)
    setStatus("")
    try {
      const resp = await callBackend<RoutePreviewResponse>("/api/location/route/preview", {
        method: "POST",
        body: JSON.stringify({
          points: routePointsPayload(),
          speed_kmh: speedKmh,
          interval_s: intervalS,
          pause_s: pauseS,
          loop,
          from_current: fromCurrent,
        }),
      })

      const line = resp.dense || resp.full_route || null
      if (!line || line.length < 2) {
        setRouteLine(null)
        setStatus("Preview returned empty route")
        return
      }

      setRouteLine(line)
      setStatus("Route preview ready")
    } catch (e: any) {
      setStatus(e?.message ?? "Route preview failed")
    } finally {
      setRouteBusy(false)
    }
  }

  async function routeSimulate() {
    if (!connected) {
      setStatus("Please connect device first")
      return
    }
    if (waypoints.length < 2) {
      setStatus("Need at least 2 waypoints")
      return
    }
    setRouteBusy(true)
    setStatus("")
    try {
      await callBackend<any>("/api/location/route/simulate", {
        method: "POST",
        body: JSON.stringify({
          points: routePointsPayload(),
          speed_kmh: speedKmh,
          interval_s: intervalS,
          pause_s: pauseS,
          loop,
          from_current: fromCurrent,
        }),
      })
      setRouteRunning(true)
      setStatus("Route simulating")
    } catch (e: any) {
      setRouteRunning(false)
      setStatus(e?.message ?? "Route simulate failed")
    } finally {
      setRouteBusy(false)
    }
  }

  async function routeStop() {
    setRouteBusy(true)
    setStatus("")
    try {
      await callBackend<any>("/api/location/route/stop", { method: "POST" })
      setRouteRunning(false)
      setStatus("Route stopped")
    } catch (e: any) {
      setStatus(e?.message ?? "Route stop failed")
    } finally {
      setRouteBusy(false)
    }
  }

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-5">
      <div className="md:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between px-2 pb-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Route Map</div>
            <div className="text-xs text-slate-500">Click map to pick pending point, Add to insert into waypoints</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={routePreview}
              disabled={routeBusy || waypoints.length < 2}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {routeBusy ? "Building…" : "Build"}
            </button>
            <button
              onClick={routeSimulate}
              disabled={routeBusy || !connected || waypoints.length < 2}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {routeRunning ? "Running" : "Simulate"}
            </button>
            <button
              onClick={routeStop}
              disabled={routeBusy || !routeRunning}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200">
          <MapRouteView
            waypoints={waypoints.map((w) => ({ id: w.id, lat: w.lat, lng: w.lng } satisfies MapWaypoint))}
            pendingPoint={pendingPoint}
            routeLine={routeLine || undefined}
            onPickPending={(p) => {
              setPendingPoint(p)
              setPendingText(`${p.lat}, ${p.lng}`)
            }}
            onDragWaypoint={(id, p) => {
              setWaypoints((prev) =>
                prev.map((w) => (w.id === id ? { ...w, lat: p.lat, lng: p.lng, text: `${p.lat}, ${p.lng}` } : w)),
              )
              setRouteLine(null)
            }}
            onRightClickWaypoint={(id) => {
              setWaypoints((prev) => prev.filter((w) => w.id !== id))
              setRouteLine(null)
            }}
            className="h-[360px] w-full"
          />
        </div>
      </div>

      <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Route Controls</div>
        <div className="mt-1 text-xs text-slate-500">Pick pending point then Add, reorder points, Build to preview road route</div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <div className="grid grid-cols-2 gap-2">
            {/* <div>
              <label className="block text-xs font-medium text-slate-700">Speed (km/h)</label>
              <input
                value={String(speedKmh)}
                onChange={(e) => setSpeedKmh(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Interval (s)</label>
              <input
                value={String(intervalS)}
                onChange={(e) => setIntervalS(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Pause at end (s)</label>
              <input
                value={String(pauseS)}
                onChange={(e) => setPauseS(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                inputMode="decimal"
              />
            </div> */}
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>
              {/* <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={fromCurrent} onChange={(e) => setFromCurrent(e.target.checked)} />
                From current
              </label> */}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Pending point</div>
            <div className="mt-1 text-xs text-slate-500">Click map or Resolve from text then Add</div>

            <input
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              placeholder="(lat, lng) or address"
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
            />

            <div className="mt-2 flex gap-2">
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                onClick={async () => {
                  setStatus("")
                  const p = pendingText.trim() ? await resolveTextToPoint(pendingText) : null
                  if (!p) {
                    setStatus("Cannot resolve pending point")
                    return
                  }
                  setPendingPoint(p)
                }}
              >
                Resolve
              </button>

              <button
                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                disabled={!pendingPoint}
                onClick={() => {
                  if (!pendingPoint) return
                  setWaypoints((prev) => [
                    ...prev,
                    {
                      id: newId(),
                      lat: pendingPoint.lat,
                      lng: pendingPoint.lng,
                      text: pendingText || `${pendingPoint.lat}, ${pendingPoint.lng}`,
                    },
                  ])
                  setPendingPoint(null)
                  setPendingText("")
                  setRouteLine(null)
                }}
              >
                Add waypoint
              </button>
            </div>

            {pendingPoint && (
              <div className="mt-3 text-[11px] font-mono text-slate-700">
                {pendingPoint.lat.toFixed(6)}, {pendingPoint.lng.toFixed(6)}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Waypoints</div>

            <div className="mt-3 space-y-2">
              {waypoints.length === 0 ? (
                <div className="text-xs text-slate-500">No waypoints</div>
              ) : (
                waypoints.map((w, idx) => (
                  <div key={w.id} className="rounded-xl bg-white p-3 shadow-sm border border-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-700">#{idx + 1}</div>
                      <div className="flex gap-2">
                        <button
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                          disabled={idx === 0}
                          onClick={() => {
                            setWaypoints((prev) => {
                              const a = [...prev]
                              ;[a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]
                              return a
                            })
                            setRouteLine(null)
                          }}
                        >
                          Up
                        </button>
                        <button
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                          disabled={idx === waypoints.length - 1}
                          onClick={() => {
                            setWaypoints((prev) => {
                              const a = [...prev]
                              ;[a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]
                              return a
                            })
                            setRouteLine(null)
                          }}
                        >
                          Down
                        </button>
                        <button
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
                          onClick={() => {
                            setWaypoints((prev) => prev.filter((x) => x.id !== w.id))
                            setRouteLine(null)
                          }}
                        >
                          Del
                        </button>
                      </div>
                    </div>

                    <input
                      value={w.text}
                      onChange={(e) => {
                        const v = e.target.value
                        setWaypoints((prev) => prev.map((x) => (x.id === w.id ? { ...x, text: v } : x)))
                      }}
                      placeholder="(lat, lng) or address"
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300"
                    />

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-[11px] font-mono text-slate-600">
                        {w.lat.toFixed(6)}, {w.lng.toFixed(6)}
                      </div>

                      <button
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
                        onClick={async () => {
                          setStatus("")
                          const p = await resolveTextToPoint(w.text)
                          if (!p) {
                            setStatus("Cannot resolve waypoint")
                            return
                          }
                          setWaypoints((prev) => prev.map((x) => (x.id === w.id ? { ...x, lat: p.lat, lng: p.lng } : x)))
                          setRouteLine(null)
                        }}
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                disabled={waypoints.length === 0 || routeBusy}
                onClick={clearRoute}
              >
                Clear
              </button>
              <button
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                disabled={waypoints.length < 2 || routeBusy}
                onClick={routePreview}
              >
                Build
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            <div className="font-semibold text-slate-900">API</div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed">
              POST /api/location/route/preview <br />
              POST /api/location/route/simulate <br />
              POST /api/location/route/stop
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}