// app/lib/savedRoutes.ts
import { callBackend } from "@/lib/api"

export type SavedRouteWaypoint = {
  id: number
  order_index: number
  lat: number
  lng: number
  text: string
}

export type SavedRouteSummary = {
  id: number
  name: string
  loop: boolean
  speed_kmh: number
  interval_s: number
  pause_s: number
  from_current: boolean
  waypoint_count: number
  created_at: string
  updated_at: string
}

export type SavedRouteDetail = {
  id: number
  name: string
  loop: boolean
  speed_kmh: number
  interval_s: number
  pause_s: number
  from_current: boolean
  waypoint_count: number
  created_at: string
  updated_at: string
  waypoints: SavedRouteWaypoint[]
}

export type RouteEditorWaypointInput = {
  lat: number
  lng: number
  text: string
}

export type SaveRoutePayload = {
  name: string
  loop: boolean
  speed_kmh: number
  interval_s: number
  pause_s: number
  from_current: boolean
  waypoints: RouteEditorWaypointInput[]
}

export async function listSavedRoutes(): Promise<SavedRouteSummary[]> {
  const res = await callBackend<{ routes: SavedRouteSummary[] }>("/api/saved-routes", {
    method: "GET",
  })
  return res.routes
}

export async function getSavedRoute(routeId: number): Promise<SavedRouteDetail> {
  const res = await callBackend<{ route: SavedRouteDetail }>(`/api/saved-routes/${routeId}`, {
    method: "GET",
  })
  return res.route
}

export async function createSavedRoute(payload: SaveRoutePayload): Promise<SavedRouteDetail> {
  const res = await callBackend<{ ok: boolean; route: SavedRouteDetail }>("/api/saved-routes", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return res.route
}

export async function updateSavedRoute(
  routeId: number,
  payload: SaveRoutePayload,
): Promise<SavedRouteDetail> {
  const res = await callBackend<{ ok: boolean; route: SavedRouteDetail }>(`/api/saved-routes/${routeId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })
  return res.route
}

export async function deleteSavedRoute(routeId: number): Promise<void> {
  await callBackend<{ ok: boolean }>(`/api/saved-routes/${routeId}`, {
    method: "DELETE",
  })
}