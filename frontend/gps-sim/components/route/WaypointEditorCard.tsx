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
    <section className="space-y-4">
      <section className="rounded-[24px] border border-[#e7eee1] bg-[#fbfcf8] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">📌 Add waypoint</div>
            <div className="mt-1 text-xs text-slate-500">
              Click map or resolve from text input
            </div>
          </div>

          {pendingPoint && (
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
              Point ready
            </span>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <input
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            placeholder="(lat, lng) or address"
            className="w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
          />

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4]"
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
              className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
              disabled={!pendingPoint}
              onClick={onAddWaypoint}
            >
              Add waypoint
            </button>
          </div>

          {pendingPoint && (
            <div className="rounded-2xl bg-white px-3 py-3 text-[12px] font-mono text-slate-700 shadow-sm">
              {pendingPoint.lat.toFixed(6)}, {pendingPoint.lng.toFixed(6)}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[24px] border border-[#e7eee1] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">🌱 Waypoints</div>
            <div className="mt-1 text-xs text-slate-500">
              {waypoints.length} points in current route
            </div>
          </div>

          <button
            className="rounded-full bg-[#f1d98c] px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:brightness-95 disabled:opacity-50"
            disabled={waypoints.length === 0}
            onClick={onClear}
          >
            Clear
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {waypoints.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[#d9e5cf] bg-[#fbfcf8] px-4 py-6 text-center">
              <div className="text-sm font-semibold text-slate-900">No waypoints yet</div>
              <div className="mt-1 text-xs text-slate-500">
                Click map to plant your first waypoint
              </div>
            </div>
          ) : (
            waypoints.map((w, idx) => (
              <div
                key={w.id}
                className="rounded-[22px] border border-[#e7eee1] bg-[#fbfcf8] p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-800 shadow-sm">
                      {idx + 1}
                    </span>
                    <div className="text-xs font-semibold text-slate-700">Waypoint {idx + 1}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#d9e5cf] bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-[#f8fbf4] disabled:opacity-50"
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
                      className="rounded-full border border-[#d9e5cf] bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-[#f8fbf4] disabled:opacity-50"
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
                      className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-600 shadow-sm hover:bg-rose-50"
                      onClick={() => {
                        setWaypoints((prev) => prev.filter((x) => x.id !== w.id))
                        setRouteLineCleared()
                      }}
                    >
                      Delete
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
                  className="mt-3 w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#b8cfa8]"
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="rounded-xl bg-white px-3 py-2 text-[12px] font-mono text-slate-700 shadow-sm">
                    {w.lat.toFixed(6)}, {w.lng.toFixed(6)}
                  </div>

                  <button
                    className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-[11px] font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4]"
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
      </section>
    </section>
  )
}