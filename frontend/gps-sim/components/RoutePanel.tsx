"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useRef, useState } from "react"
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
import WorkspaceTopLeft from "@/components/WorkspaceTopLeft"
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { callCloud, callLocal } from "@/lib/api"



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

function SortableWaypointRow({
  waypoint,
  index,
  total,
  onDelete,
}: {
  waypoint: {
    id: string
    lat: number
    lng: number
    text: string
  }
  index: number
  total: number
  onDelete: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: waypoint.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-3 ${
        index !== total - 1 ? "border-b border-[#eef2ea]" : ""
      } ${isDragging ? "z-10 bg-[#f8fbf4] shadow-md" : "bg-white"}`}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f3f6ee] text-xs font-semibold text-slate-800">
        {index + 1}
      </div>

      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-full border border-[#d9e5cf] bg-white text-sm text-slate-500 shadow-sm active:cursor-grabbing"
        aria-label="Drag waypoint"
      >
        ≡
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-mono text-slate-900">
          {waypoint.lat.toFixed(6)}, {waypoint.lng.toFixed(6)}
        </div>
      </div>

      <button
        className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-600 shadow-sm hover:bg-rose-50"
        onClick={() => onDelete(waypoint.id)}
      >
        ×
      </button>
    </div>
  )
}

export default function RoutePanel({
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

  const [panelTab, setPanelTab] = useState<"current" | "saved">("current")
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)

  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveMode, setSaveMode] = useState<"new" | "replace">("new")
  const [newRouteName, setNewRouteName] = useState("")
  const [replaceTargetId, setReplaceTargetId] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over || active.id === over.id) return

    setWaypoints((prev) => {
      const oldIndex = prev.findIndex((w) => w.id === active.id)
      const newIndex = prev.findIndex((w) => w.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return prev

      return arrayMove(prev, oldIndex, newIndex)
    })

    setRouteLine(null)
  }

  async function handleSaveAsNewWithName(name: string) {
    if (!name.trim()) {
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
      const saved = await createSavedRoute({
        name: name.trim(),
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
      })

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

  async function handleReplaceRoute(routeId: number) {
    if (!routeId) {
      setStatus("Please select a route to replace")
      return
    }
    if (waypoints.length < 2) {
      setStatus("Need at least 2 waypoints")
      return
    }

    setSaveBusy(true)
    setStatus("")

    try {
      const target = savedRoutes.find((r) => r.id === routeId)
      const updated = await updateSavedRoute(routeId, {
        name: target?.name || routeName.trim() || "Untitled route",
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
      })

      setCurrentRouteId(updated.id)
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
      setStatus(`Replaced "${updated.name}"`)
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to replace route")
    } finally {
      setSaveBusy(false)
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
      const resp = await callLocal<RoutePreviewResponse>("/location/route/preview", {
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
      await callLocal<any>("/location/route/simulate", {
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
      await callLocal<any>("/location/route/stop", { method: "POST" })
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

  async function handleUpdateById(id: number) {
    try {
      await callCloud(`/api/saved-routes/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: routeName,
          loop,
          waypoints,
        }),
      })
      setStatus("Route updated")
      refreshSavedRoutes()
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to update route")
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
    <>
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
              className="h-full w-full"
            />

            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#f6f4ea]/90 via-[#f6f4ea]/35 to-transparent" />

            <WorkspaceTopLeft
              mode={mode}
              onModeChange={onModeChange}
              title="🛤 Route mode"
              subtitle="Click map to add points, then build and simulate"
              statusLabel={
                previewState === "running"
                  ? "Running"
                  : previewState === "ready"
                    ? "Preview ready"
                    : "Draft"
              }
              statusTone={
                previewState === "running"
                  ? "success"
                  : previewState === "ready"
                    ? "info"
                    : "neutral"
              }
            />

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
                      🌱 Current
                    </button>

                    <button
                      onClick={() => setPanelTab("saved")}
                      className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        panelTab === "saved"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      📦 Saved
                    </button>
                  </div>

                  <div className="px-1 pb-4 pt-3">
                    {panelTab === "current" ? (
                      <div className="text-xs text-slate-500">
                        Edit current route, build preview, then simulate
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        Search and apply saved routes
                      </div>
                    )}
                  </div>
                </div>

                <div className="max-h-[calc(78vh-92px)] overflow-y-auto px-4 py-4">
                  {panelTab === "current" ? (
                    <div className="space-y-5">
                      <div className="space-y-3">
                        {/* <input
                          value={routeName}
                          onChange={(e) => setRouteName(e.target.value)}
                          placeholder="Route name"
                          className="w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
                        /> */}

                        <input
                          value={pendingText}
                          onChange={(e) => setPendingText(e.target.value)}
                          placeholder="(lat, lng) or address"
                          className="w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4]"
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
                            Search
                          </button>

                          <button
                            className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
                            disabled={!pendingPoint}
                            onClick={() => {
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
                          >
                            Add waypoint
                          </button>

                          <label className="ml-auto flex items-center gap-2 rounded-full bg-[#fbfcf8] px-3 py-2 text-xs font-semibold text-slate-700">
                            <span>Loop</span>
                            <button
                              type="button"
                              onClick={() => setLoop(!loop)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                loop ? "bg-[#7bc47f]" : "bg-slate-200"
                              }`}
                              aria-pressed={loop}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${
                                  loop ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </label>
                        </div>

                        {pendingPoint && (
                          <div className="rounded-xl bg-[#fbfcf8] px-3 py-2 text-[12px] font-mono text-slate-700">
                            {pendingPoint.lat.toFixed(6)}, {pendingPoint.lng.toFixed(6)}
                          </div>
                        )}
                      </div>

                      <div className="h-px bg-[#e7eee1]" />

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            Waypoints {waypoints.length > 0 ? `(${waypoints.length})` : ""}
                          </div>

                          <button
                            className="rounded-full bg-[#f1d98c] px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:brightness-95 disabled:opacity-50"
                            disabled={waypoints.length === 0}
                            onClick={() => {
                              clearRoute()
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {waypoints.length === 0 ? (
                          <div className="rounded-[20px] border border-dashed border-[#d9e5cf] bg-[#fbfcf8] px-4 py-6 text-center">
                            <div className="text-sm font-semibold text-slate-900">No waypoints yet</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Click map to plant your first waypoint
                            </div>
                          </div>
                        ) : (
                          <div className="overflow-hidden rounded-2xl border border-[#e7eee1] bg-white">
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={handleDragEnd}
                            >
                              <SortableContext
                                items={waypoints.map((w) => w.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                {waypoints.map((w, idx) => (
                                  <SortableWaypointRow
                                    key={w.id}
                                    waypoint={w}
                                    index={idx}
                                    total={waypoints.length}
                                    onDelete={(id) => {
                                      setWaypoints((prev) => prev.filter((x) => x.id !== id))
                                      setRouteLine(null)
                                    }}
                                  />
                                ))}
                              </SortableContext>
                            </DndContext>
                          </div>
                        )}
                      </div>

                      <div className="h-px bg-[#e7eee1]" />

                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => routePreview()}
                            disabled={routeBusy || waypoints.length < 2}
                            className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4] disabled:opacity-50"
                          >
                            {routeBusy ? "Building…" : "Build route"}
                          </button>

                          <button
                            onClick={routeSimulate}
                            disabled={routeBusy || !connected || waypoints.length < 2}
                            className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
                          >
                            {routeRunning ? "Running" : "Start"}
                          </button>

                          <button
                            onClick={routeStop}
                            disabled={routeBusy || !routeRunning}
                            className="rounded-full bg-[#f1d98c] px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:brightness-95 disabled:opacity-50"
                          >
                            Stop
                          </button>
                        </div>

                        <div className="relative">
                          <button
                            onClick={() => {
                              setSaveDialogOpen(true)
                              setSaveMode(currentRouteId ? "replace" : "new")
                              setNewRouteName(routeName || "")
                              setReplaceTargetId(currentRouteId ?? null)
                            }}
                            disabled={saveBusy}
                            className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
                          >
                            {saveBusy ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {saveDialogOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="text-lg font-semibold text-slate-900">Save route</div>

            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={saveMode === "new"}
                  onChange={() => setSaveMode("new")}
                />
                <span className="text-sm text-slate-800">Save as new</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={saveMode === "replace"}
                  onChange={() => setSaveMode("replace")}
                />
                <span className="text-sm text-slate-800">Replace existing</span>
              </label>
            </div>

            {saveMode === "new" && (
              <div className="mt-4">
                <input
                  value={newRouteName}
                  onChange={(e) => setNewRouteName(e.target.value)}
                  placeholder="Route name"
                  className="w-full rounded-xl border border-[#d9e5cf] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                />
              </div>
            )}

            {saveMode === "replace" && (
              <div className="mt-4 max-h-40 overflow-y-auto rounded-xl border border-[#e7eee1]">
                {savedRoutes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setReplaceTargetId(r.id)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      replaceTargetId === r.id
                        ? "bg-[#f3f6ee]"
                        : "hover:bg-[#f8fbf4]"
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setSaveDialogOpen(false)}
                className="rounded-full px-4 py-2 text-sm text-slate-600"
              >
                Cancel
              </button>

              <button
                onClick={async () => {
                  if (saveMode === "new") {
                    await handleSaveAsNewWithName(newRouteName)
                  } else {
                    if (!replaceTargetId) {
                      setStatus("Please select a route to replace")
                      return
                    }
                    await handleReplaceRoute(replaceTargetId)
                  }

                  setSaveDialogOpen(false)
                }}
                className="rounded-full bg-[#7bc47f] px-4 py-2 text-sm font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}