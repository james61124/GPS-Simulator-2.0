// app/page.tsx
"use client"

import { useState } from "react"
import { callBackend } from "@/app/lib/api"
import { useDevices } from "@/app/hooks/useDevices"
import SinglePanel from "@/app/components/SinglePanel"
import RoutePanel from "@/app/components/RoutePanel"

export default function Page() {
  const [mode, setMode] = useState<"single" | "route">("single")
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const { loading, status, setStatus, deviceOptions, selected, setSelected, refresh } = useDevices()

  async function connect() {
    if (!selected) {
      setStatus("Please select a device")
      return
    }

    setConnecting(true)
    setStatus("")
    try {
      await callBackend<any>("/api/connect", {
        method: "POST",
        body: JSON.stringify({
          udid: selected.udid,
          connType: selected.connType,
          ios_version: selected.ios_version,
        }),
      })
      setConnected(true)
      setStatus("Connected")
    } catch (e: any) {
      setConnected(false)
      setStatus(e?.message ?? "Connect failed")
    } finally {
      setConnecting(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">GeoPort</h1>
            <p className="mt-1 text-sm text-slate-600">Select device, connect, then use Single or Route mode</p>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="w-full md:max-w-2xl">
              <label className="block text-sm font-medium text-slate-700">Device</label>
              <div className="mt-2 flex gap-3">
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
                  value={selected ? `${selected.udid}::${selected.connType}` : ""}
                  onChange={(e) => {
                    const key = e.target.value
                    const next = deviceOptions.find((x) => `${x.udid}::${x.connType}` === key) || null
                    setSelected(next)
                    setStatus("")
                    setConnected(false)
                  }}
                  disabled={loading || deviceOptions.length === 0}
                >
                  {deviceOptions.length === 0 ? (
                    <option value="">No devices</option>
                  ) : (
                    deviceOptions.map((d) => (
                      <option key={`${d.udid}::${d.connType}`} value={`${d.udid}::${d.connType}`}>
                        {d.label}
                      </option>
                    ))
                  )}
                </select>

                <button
                  onClick={refresh}
                  className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={connect}
                disabled={!selected || connecting}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setMode("single")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold shadow-sm ${
                mode === "single"
                  ? "bg-slate-900 text-white"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Single
            </button>
            <button
              onClick={() => setMode("route")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold shadow-sm ${
                mode === "route"
                  ? "bg-slate-900 text-white"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Route
            </button>
          </div>

          {status && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">{status}</div>
          )}
        </div>

        {mode === "single" ? (
          <SinglePanel connected={connected} status={status} setStatus={setStatus} />
        ) : (
          <RoutePanel connected={connected} status={status} setStatus={setStatus} />
        )}
      </div>
    </main>
  )
}