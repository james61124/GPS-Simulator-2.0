"use client"

export default function RouteDetailsCard({
  routeName,
  setRouteName,
  loop,
  setLoop,
  currentRouteId,
  onSave,
  onUpdate,
  onNew,
  saveBusy,
  hasUnsavedChanges = false,
}: {
  routeName: string
  setRouteName: (v: string) => void
  loop: boolean
  setLoop: (v: boolean) => void
  currentRouteId: number | null
  onSave: () => void
  onUpdate: () => void
  onNew: () => void
  saveBusy: boolean
  hasUnsavedChanges?: boolean
}) {
  return (
    <section className="rounded-[24px] border border-[#e7eee1] bg-[#fbfcf8] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">🌿 Route details</div>
          <div className="mt-1 text-xs text-slate-500">
            Name this route, then save it or update current version
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
            {currentRouteId ? `Saved #${currentRouteId}` : "New draft"}
          </span>

          {hasUnsavedChanges && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
              Unsaved changes
            </span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Route name
        </label>
        <input
          value={routeName}
          onChange={(e) => setRouteName(e.target.value)}
          placeholder="Morning commute"
          className="mt-2 w-full rounded-2xl border border-[#d9e5cf] bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-[#e7eee1] bg-white px-4 py-3 shadow-sm">
        <label className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Loop route</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Return to starting point after last waypoint
            </div>
          </div>

          <button
            type="button"
            onClick={() => setLoop(!loop)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
              loop ? "bg-[#7bc47f]" : "bg-slate-200"
            }`}
            aria-pressed={loop}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${
                loop ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={onSave}
          disabled={saveBusy}
          className="rounded-full bg-[#7bc47f] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
        >
          {saveBusy ? "Saving…" : "Save as new"}
        </button>

        <button
          onClick={onUpdate}
          disabled={saveBusy || !currentRouteId}
          className="rounded-full border border-[#d9e5cf] bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-[#f8fbf4] disabled:opacity-50"
        >
          Update current
        </button>

        <button
          onClick={onNew}
          disabled={saveBusy}
          className="rounded-full bg-[#f1d98c] px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:brightness-95 disabled:opacity-50"
        >
          New draft
        </button>
      </div>
    </section>
  )
}