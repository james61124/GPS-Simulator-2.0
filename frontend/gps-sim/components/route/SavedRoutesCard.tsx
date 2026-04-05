"use client"

import { useMemo, useState } from "react"
import type { SavedRouteSummary } from "@/lib/savedRoutes"

function formatTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString()
}

export default function SavedRoutesCard({
  routes,
  currentId,
  loading = false,
  busyId = null,
  onRefresh,
  onApply,
  onDelete,
  onDuplicate,
}: {
  routes: SavedRouteSummary[]
  currentId: number | null
  loading?: boolean
  busyId?: number | null
  onRefresh?: () => void
  onApply: (id: number) => void
  onDelete: (id: number) => void
  onDuplicate: (id: number) => void
}) {
  const [query, setQuery] = useState("")

  const filteredRoutes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return routes
    return routes.filter((r) => r.name.toLowerCase().includes(q))
  }, [routes, query])

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">My Routes</div>
          <div className="mt-1 text-xs text-slate-500">
            Search, apply, duplicate, or delete saved routes
          </div>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      <div className="mt-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search routes"
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
        />
      </div>

      <div className="mt-4 space-y-3">
        {loading && routes.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Loading routes...
          </div>
        ) : filteredRoutes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            {routes.length === 0 ? "No saved routes yet" : "No matching routes"}
          </div>
        ) : (
          filteredRoutes.map((route) => {
            const active = currentId === route.id
            const busy = busyId === route.id

            return (
              <div
                key={route.id}
                className={`rounded-2xl border p-4 transition ${
                  active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {route.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {route.waypoint_count} waypoints · {route.loop ? "Loop" : "One-way"}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Updated {formatTime(route.updated_at)}
                    </div>
                  </div>

                  {active && (
                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white">
                      Current
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => onApply(route.id)}
                    disabled={busy}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busy ? "Loading…" : "Apply"}
                  </button>

                  <button
                    onClick={() => onDuplicate(route.id)}
                    disabled={busy}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    Duplicate
                  </button>

                  <button
                    onClick={() => onDelete(route.id)}
                    disabled={busy}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}