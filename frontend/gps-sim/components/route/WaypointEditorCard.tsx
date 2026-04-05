"use client"

import { resolveTextToPoint, type LatLng } from "@/lib/geo"

type Waypoint = {
  id: string
  lat: number
  lng: number
  text: string
}

export default function WaypointEditorCard({
  pendingPoint,
  pendingText,
  setPendingText,
  onResolvePending,
  onAddWaypoint,
  waypoints,
  setWaypoints,
  onClear,
  setRouteLineCleared,
  setStatus,
}: {
  pendingPoint: LatLng | null
  pendingText: string
  setPendingText: (v: string) => void
  onResolvePending: (p: LatLng) => void
  onAddWaypoint: () => void
  waypoints: Waypoint[]
  setWaypoints: React.Dispatch<React.SetStateAction<Waypoint[]>>
  onClear: () => void
  setRouteLineCleared: () => void
  setStatus: (s: string) => void
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-900">Waypoint Editor</div>
      <div className="mt-1 text-xs text-slate-500">
        Click map or paste address / coordinates, then build route preview
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="text-sm font-semibold text-slate-900">Add waypoint</div>
        <div className="mt-1 text-xs text-slate-500">Click map or resolve from text input</div>

        <input
          value={pendingText}
          onChange={(e) => setPendingText(e.target.value)}
          placeholder="(lat, lng) or address"
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            onClick={async () => {
              setStatus("")
              const p = pendingText.trim() ? await resolveTextToPoint(pendingText) : null
              if (!p) {
                setStatus("Cannot resolve pending point")
                return
              }
              onResolvePending(p)
            }}
          >
            Resolve
          </button>

          <button
            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={!pendingPoint}
            onClick={onAddWaypoint}
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

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Waypoints</div>
            <div className="mt-1 text-xs text-slate-500">{waypoints.length} points in current route</div>
          </div>

          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={waypoints.length === 0}
            onClick={onClear}
          >
            Clear
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {waypoints.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-xs text-slate-500 shadow-sm">
              No waypoints
            </div>
          ) : (
            waypoints.map((w, idx) => (
              <div key={w.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
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
                        setRouteLineCleared()
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
                        setRouteLineCleared()
                      }}
                    >
                      Down
                    </button>

                    <button
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
                      onClick={() => {
                        setWaypoints((prev) => prev.filter((x) => x.id !== w.id))
                        setRouteLineCleared()
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
                      setWaypoints((prev) =>
                        prev.map((x) => (x.id === w.id ? { ...x, lat: p.lat, lng: p.lng } : x)),
                      )
                      setRouteLineCleared()
                    }}
                  >
                    Resolve
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}