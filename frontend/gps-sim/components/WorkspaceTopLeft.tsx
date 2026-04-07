"use client"

type Props = {
  mode: "single" | "route"
  onModeChange: (nextMode: "single" | "route") => void
  title: string
  subtitle: string
  statusLabel: string
  statusTone?: "neutral" | "success" | "info"
}

export default function WorkspaceTopLeft({
  mode,
  onModeChange,
  title,
  subtitle,
  statusLabel,
  statusTone = "neutral",
}: Props) {
  const statusClass =
    statusTone === "success"
      ? "bg-emerald-100/90 text-emerald-800"
      : statusTone === "info"
        ? "bg-sky-100/90 text-sky-800"
        : "bg-white/85 text-slate-700"

  return (
    <div className="absolute left-5 top-5 z-[500] flex max-w-[calc(100%-2rem)] flex-col gap-3">
      <div className="flex w-fit items-center rounded-full bg-white/88 p-1 shadow-sm backdrop-blur">
        <button
          onClick={() => onModeChange("single")}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            mode === "single"
              ? "bg-[#f3f6ee] text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          📍 Single
        </button>

        <button
          onClick={() => onModeChange("route")}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            mode === "route"
              ? "bg-[#f3f6ee] text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          🛤 Route
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-full border border-white/70 bg-white/85 px-4 py-2 shadow-sm backdrop-blur">
          <div className="text-xs font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 text-[11px] text-slate-600">{subtitle}</div>
        </div>

        <span
          className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  )
}