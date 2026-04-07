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
    <section className="space-y-4">
      <section className="rounded-[24px] border border-[#e7eee1] bg-[#fbfcf8] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">📦 Saved routes</div>
            <div className="mt-1 text-xs text-slate-500">
              Search, apply, duplicate, or delete your saved routes
            </div>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4] disabled:opacity-50"
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
            className="w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
          />
        </div>
      </section>

      <section className="space-y-3">
        {loading && routes.length === 0 ? (
          <div className="rounded-[24px] border border-[#e7eee1] bg-white px-4 py-8 text-center">
            <div className="text-sm font-semibold text-slate-900">Loading routes…</div>
            <div className="mt-1 text-xs text-slate-500">
              Gathering your saved route library
            </div>
          </div>
        ) : filteredRoutes.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#d9e5cf] bg-[#fbfcf8] px-4 py-8 text-center">
            <div className="text-sm font-semibold text-slate-900">
              {routes.length === 0 ? "No saved routes yet" : "No matching routes"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {routes.length === 0
                ? "Save your current route to build your library 🌱"
                : "Try another keyword"}
            </div>
          </div>
        ) : (
          filteredRoutes.map((route) => {
            const active = currentId === route.id
            const busy = busyId === route.id

            return (
              <div
                key={route.id}
                className={`rounded-[24px] border p-4 shadow-sm transition ${
                  active
                    ? "border-[#b8cfa8] bg-[#f6fbf1]"
                    : "border-[#e7eee1] bg-white hover:bg-[#fcfdf9]"
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
                    <div className="mt-2 text-[11px] text-slate-400">
                      Updated {formatTime(route.updated_at)}
                    </div>
                  </div>

                  {active && (
                    <span className="rounded-full bg-[#7bc47f] px-3 py-1 text-[10px] font-semibold text-white shadow-sm">
                      Current
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => onApply(route.id)}
                    disabled={busy}
                    className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
                  >
                    {busy ? "Loading…" : "Apply"}
                  </button>

                  <button
                    onClick={() => onDuplicate(route.id)}
                    disabled={busy}
                    className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4] disabled:opacity-50"
                  >
                    Duplicate
                  </button>

                  <button
                    onClick={() => onDelete(route.id)}
                    disabled={busy}
                    className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-rose-600 shadow-sm hover:bg-rose-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })
        )}
      </section>
    </section>
  )
}