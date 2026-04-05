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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Route Details</div>
          <div className="mt-1 text-xs text-slate-500">
            Name this route, save it, or update current saved version
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
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
        <label className="block text-xs font-medium text-slate-700">Route name</label>
        <input
          value={routeName}
          onChange={(e) => setRouteName(e.target.value)}
          placeholder="Morning commute"
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Loop route
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={onSave}
          disabled={saveBusy}
          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {saveBusy ? "Saving…" : "Save as new"}
        </button>

        <button
          onClick={onUpdate}
          disabled={saveBusy || !currentRouteId}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Update current
        </button>

        <button
          onClick={onNew}
          disabled={saveBusy}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          New draft
        </button>
      </div>
    </section>
  )
}