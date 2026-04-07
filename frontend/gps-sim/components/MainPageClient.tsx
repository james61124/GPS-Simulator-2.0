// components/MainPageClient.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { callBackend } from "@/lib/api"
import { useDevices } from "@/hooks/useDevices"
import { useAuthGuard } from "@/hooks/useAuthGuard"
import SinglePanel from "@/components/SinglePanel"
import RoutePanel from "@/components/RoutePanel"

export default function MainPageClient() {
  const router = useRouter()
  const { isAuthenticated, loading: authLoading, requireLogin } = useAuthGuard()

  const [mode, setMode] = useState<"single" | "route">("single")
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const { loading, status, setStatus, deviceOptions, selected, setSelected, refresh } = useDevices()

  async function handleRefresh() {
    if (!requireLogin()) return
    await refresh()
  }

  async function connect() {
    if (!requireLogin()) return

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

  function handleModeChange(nextMode: "single" | "route") {
    if (!requireLogin()) return
    setMode(nextMode)
  }

  function handleDeviceChange(value: string) {
    if (!requireLogin()) return

    const next = deviceOptions.find((x) => `${x.udid}::${x.connType}` === value) || null
    setSelected(next)
    setStatus("")
    setConnected(false)
  }

  const locked = authLoading || !isAuthenticated

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="rounded-[28px] border border-[#dfe7dc] bg-[#f6f4ea] px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div>
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">GeoPort 🌱</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Connect device, then switch between Single and Route mode
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!authLoading && !isAuthenticated && (
                <button
                  onClick={() => router.push("/login")}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                >
                  Login
                </button>
              )}

              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${
                  connected ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-600"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>
          </div>

          {!authLoading && !isAuthenticated && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Please log in with Google before using any feature
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Device
                </label>

                <div className="flex gap-2">
                  <select
                    className="w-full rounded-full border border-[#d9e5cf] bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-[#b8cfa8]"
                    value={selected ? `${selected.udid}::${selected.connType}` : ""}
                    onChange={(e) => handleDeviceChange(e.target.value)}
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
                    onClick={handleRefresh}
                    className="shrink-0 rounded-full border border-[#d9e5cf] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-[#f8fbf4] disabled:opacity-50"
                    disabled={loading}
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              </div>

              <button
                onClick={connect}
                disabled={!selected || connecting}
                className="shrink-0 rounded-full bg-[#7bc47f] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>

          {status && (
            <div className="mt-4 rounded-2xl border border-[#e7eee1] bg-white/80 px-4 py-3 text-sm text-slate-700">
              {status}
            </div>
          )}
        </div>

        <div className="relative">
          {locked && (
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="absolute inset-0 z-10 mt-6 rounded-[28px] bg-white/50 backdrop-blur-[1px]"
              aria-label="Login required panels"
            />
          )}

          {mode === "single" ? (
            <SinglePanel
              connected={connected}
              status={status}
              setStatus={setStatus}
              mode={mode}
              onModeChange={handleModeChange}
            />
          ) : (
            <RoutePanel
              connected={connected}
              status={status}
              setStatus={setStatus}
              mode={mode}
              onModeChange={handleModeChange}
            />
          )}
        </div>
      </div>
    </main>
  )
}