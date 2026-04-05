"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useRef, useState } from "react"
import { callBackend } from "@/lib/api"
import { resolveTextToPoint, type LatLng } from "@/lib/geo"
import type { Waypoint as MapWaypoint } from "@/components/MapRoute"
import {
  createSavedRoute,
  deleteSavedRoute,
  getSavedRoute,
  listSavedRoutes,
  updateSavedRoute,
  type SavedRouteSummary,
} from "@/lib/savedRoutes"
import RouteDetailsCard from "@/components/route/RouteDetailsCard"
import SavedRoutesCard from "@/components/route/SavedRoutesCard"
import WaypointEditorCard from "@/components/route/WaypointEditorCard"



const MapRouteView = dynamic(() => import("./MapRoute"), { ssr: false })

type RoutePreviewResponse = {
  status: string
  full_route?: LatLng[]
  dense?: LatLng[]
}

type Waypoint = {
  id: string
  lat: number
  lng: number
  text: string
}

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

  const [routeName, setRouteName] = useState("")
  const [currentRouteId, setCurrentRouteId] = useState<number | null>(null)

  const [savedRoutes, setSavedRoutes] = useState<SavedRouteSummary[]>([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false)
  const [savedRoutesBusyId, setSavedRoutesBusyId] = useState<number | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("")

  const newId = () => crypto.randomUUID()

  const previewState = useMemo(() => {
    if (routeRunning) return "running"
    if (routeLine && routeLine.length >= 2) return "ready"
    return "draft"
  }, [routeRunning, routeLine])

  const hasUnsavedChanges = useMemo(() => {
    return buildSnapshot() !== lastSavedSnapshot
  }, [routeName, loop, speedKmh, intervalS, pauseS, fromCurrent, waypoints, lastSavedSnapshot])

  function routePointsPayload() {
    return waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))
  }

  function toSavePayload() {
    return {
      name: routeName.trim(),
      loop,
      speed_kmh: speedKmh,
      interval_s: intervalS,
      pause_s: pauseS,
      from_current: fromCurrent,
      waypoints: waypoints.map((w) => ({
        lat: w.lat,
        lng: w.lng,
        text: w.text,
      })),
    }
  }

  function buildSnapshot(payload = toSavePayload()) {
    return JSON.stringify(payload)
  }

  function markCurrentAsSaved(payload = toSavePayload()) {
    setLastSavedSnapshot(buildSnapshot(payload))
  }

  function resetEditor() {
    setCurrentRouteId(null)
    setRouteName("")
    setWaypoints([])
    setPendingPoint(null)
    setPendingText("")
    setRouteLine(null)
    setRouteRunning(false)
    setLoop(false)
    setSpeedKmh(18)
    setIntervalS(0.5)
    setPauseS(0.0)
    setFromCurrent(false)
    setLastSavedSnapshot("")
  }

  function clearRoute() {
    setWaypoints([])
    setPendingPoint(null)
    setPendingText("")
    setRouteLine(null)
    setRouteRunning(false)
  }

  async function refreshSavedRoutes() {
    setSavedRoutesLoading(true)
    try {
      const routes = await listSavedRoutes()
      setSavedRoutes(routes)
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to load saved routes")
    } finally {
      setSavedRoutesLoading(false)
    }
  }

  async function routePreview(customWaypoints?: Waypoint[], opts?: { silent?: boolean }) {
    const points = customWaypoints ?? waypoints

    if (points.length < 2) {
      if (!opts?.silent) setStatus("Need at least 2 waypoints")
      return
    }

    setRouteBusy(true)
    if (!opts?.silent) setStatus("")

    try {
      const resp = await callBackend<RoutePreviewResponse>("/api/location/route/preview", {
        method: "POST",
        body: JSON.stringify({
          points: points.map((w) => ({ lat: w.lat, lng: w.lng })),
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
        if (!opts?.silent) setStatus("Preview returned empty route")
        return
      }

      setRouteLine(line)
      if (!opts?.silent) setStatus("Route preview ready")
    } catch (e: any) {
      if (!opts?.silent) setStatus(e?.message ?? "Route preview failed")
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

  async function handleSaveAsNew() {
    if (!routeName.trim()) {
      setStatus("Please enter route name")
      return
    }
    if (waypoints.length < 2) {
      setStatus("Need at least 2 waypoints")
      return
    }

    setSaveBusy(true)
    setStatus("")
    try {
      const saved = await createSavedRoute(toSavePayload())
      setCurrentRouteId(saved.id)
      setRouteName(saved.name)
      markCurrentAsSaved({
        name: saved.name,
        loop: saved.loop,
        speed_kmh: saved.speed_kmh,
        interval_s: saved.interval_s,
        pause_s: saved.pause_s,
        from_current: saved.from_current,
        waypoints: saved.waypoints.map((w) => ({
          lat: w.lat,
          lng: w.lng,
          text: w.text,
        })),
      })
      await refreshSavedRoutes()
      setStatus("Route saved")
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to save route")
    } finally {
      setSaveBusy(false)
    }
  }

  async function handleUpdateCurrent() {
    if (!currentRouteId) {
      setStatus("No saved route selected")
      return
    }
    if (!routeName.trim()) {
      setStatus("Please enter route name")
      return
    }
    if (waypoints.length < 2) {
      setStatus("Need at least 2 waypoints")
      return
    }

    setSaveBusy(true)
    setStatus("")
    try {
      const updated = await updateSavedRoute(currentRouteId, toSavePayload())
      setRouteName(updated.name)
      markCurrentAsSaved({
        name: updated.name,
        loop: updated.loop,
        speed_kmh: updated.speed_kmh,
        interval_s: updated.interval_s,
        pause_s: updated.pause_s,
        from_current: updated.from_current,
        waypoints: updated.waypoints.map((w) => ({
          lat: w.lat,
          lng: w.lng,
          text: w.text,
        })),
      })
      await refreshSavedRoutes()
      setStatus("Route updated")
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to update route")
    } finally {
      setSaveBusy(false)
    }
  }

  async function handleApplySavedRoute(routeId: number) {
    setSavedRoutesBusyId(routeId)
    setStatus("")
    try {
      const route = await getSavedRoute(routeId)

      const nextWaypoints: Waypoint[] = route.waypoints.map((wp) => ({
        id: crypto.randomUUID(),
        lat: wp.lat,
        lng: wp.lng,
        text: wp.text || `${wp.lat}, ${wp.lng}`,
      }))

      setCurrentRouteId(route.id)
      setRouteName(route.name)
      setLoop(route.loop)
      setSpeedKmh(route.speed_kmh)
      setIntervalS(route.interval_s)
      setPauseS(route.pause_s)
      setFromCurrent(route.from_current)
      setWaypoints(nextWaypoints)
      setPendingPoint(null)
      setPendingText("")
      setRouteLine(null)
      setRouteRunning(false)
      setLastSavedSnapshot(
        JSON.stringify({
          name: route.name,
          loop: route.loop,
          speed_kmh: route.speed_kmh,
          interval_s: route.interval_s,
          pause_s: route.pause_s,
          from_current: route.from_current,
          waypoints: route.waypoints.map((wp) => ({
            lat: wp.lat,
            lng: wp.lng,
            text: wp.text || `${wp.lat}, ${wp.lng}`,
          })),
        }),
      )

      if (nextWaypoints.length >= 2) {
        setTimeout(() => {
          routePreview(nextWaypoints, { silent: true })
        }, 0)
      }

      setStatus(`Applied "${route.name}"`)
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to load route")
    } finally {
      setSavedRoutesBusyId(null)
    }
  }

  async function handleDeleteSavedRoute(routeId: number) {
    const target = savedRoutes.find((r) => r.id === routeId)
    const ok = window.confirm(`Delete route "${target?.name ?? routeId}"?`)
    if (!ok) return

    setSavedRoutesBusyId(routeId)
    setStatus("")
    try {
      await deleteSavedRoute(routeId)

      if (currentRouteId === routeId) {
        resetEditor()
      }

      await refreshSavedRoutes()
      setStatus("Route deleted")
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to delete route")
    } finally {
      setSavedRoutesBusyId(null)
    }
  }

  async function handleDuplicateSavedRoute(routeId: number) {
    setSavedRoutesBusyId(routeId)
    setStatus("")

    try {
      const route = await getSavedRoute(routeId)

      const duplicatedName = `${route.name} Copy`

      const saved = await createSavedRoute({
        name: duplicatedName,
        loop: route.loop,
        speed_kmh: route.speed_kmh,
        interval_s: route.interval_s,
        pause_s: route.pause_s,
        from_current: route.from_current,
        waypoints: route.waypoints.map((wp) => ({
          lat: wp.lat,
          lng: wp.lng,
          text: wp.text || `${wp.lat}, ${wp.lng}`,
        })),
      })

      await refreshSavedRoutes()
      setStatus(`Duplicated as "${saved.name}"`)
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to duplicate route")
    } finally {
      setSavedRoutesBusyId(null)
    }
  }

  useEffect(() => {
    refreshSavedRoutes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      e.preventDefault()
      e.returnValue = ""
    }

    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [hasUnsavedChanges])

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,420px)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 px-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Route Studio</div>
            <div className="text-xs text-slate-500">
              Click map to add points, build route preview, then simulate
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                previewState === "running"
                  ? "bg-emerald-50 text-emerald-700"
                  : previewState === "ready"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {previewState === "running"
                ? "Running"
                : previewState === "ready"
                  ? "Preview ready"
                  : "Draft"}
            </span>

            <button
              onClick={() => routePreview()}
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

        <div className="relative overflow-hidden rounded-3xl border border-slate-200">
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
            className="h-[420px] w-full"
          />
        </div>
      </div>

      <div className="space-y-6">
        <RouteDetailsCard
          routeName={routeName}
          setRouteName={setRouteName}
          loop={loop}
          setLoop={setLoop}
          currentRouteId={currentRouteId}
          onSave={handleSaveAsNew}
          onUpdate={handleUpdateCurrent}
          onNew={resetEditor}
          saveBusy={saveBusy}
          hasUnsavedChanges={hasUnsavedChanges}
        />

        <SavedRoutesCard
          routes={savedRoutes}
          currentId={currentRouteId}
          loading={savedRoutesLoading}
          busyId={savedRoutesBusyId}
          onRefresh={refreshSavedRoutes}
          onApply={handleApplySavedRoute}
          onDelete={handleDeleteSavedRoute}
          onDuplicate={handleDuplicateSavedRoute}
        />

        <WaypointEditorCard
          pendingPoint={pendingPoint}
          pendingText={pendingText}
          setPendingText={setPendingText}
          onResolvePending={(p) => {
            setPendingPoint(p)
          }}
          onAddWaypoint={() => {
            if (!pendingPoint) return
            setWaypoints((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                lat: pendingPoint.lat,
                lng: pendingPoint.lng,
                text: pendingText || `${pendingPoint.lat}, ${pendingPoint.lng}`,
              },
            ])
            setPendingPoint(null)
            setPendingText("")
            setRouteLine(null)
          }}
          waypoints={waypoints}
          setWaypoints={setWaypoints}
          onClear={() => {
            clearRoute()
          }}
          setRouteLineCleared={() => {
            setRouteLine(null)
          }}
          setStatus={setStatus}
        />
      </div>
    </div>
  )
}