// app/hooks/useDevices.ts
"use client"

import { useEffect, useMemo, useState } from "react"
import { callBackend } from "@/lib/api"

export type DeviceInfo = {
  Identifier: string
  DeviceName?: string
  DeviceClass?: string
  ProductVersion?: string
  ProductType?: string
  ConnectionType: string
}

export type DevicesResponse = Record<string, Record<string, DeviceInfo[]>>

export type SelectedDevice = {
  udid: string
  connType: string
  ios_version?: string
  label: string
}

export function useDevices() {
  const [devicesRaw, setDevicesRaw] = useState<DevicesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SelectedDevice | null>(null)
  const [status, setStatus] = useState<string>("")

  const deviceOptions = useMemo(() => {
    const opts: SelectedDevice[] = []
    if (!devicesRaw) return opts

    for (const [udid, byConn] of Object.entries(devicesRaw)) {
      for (const [connType, arr] of Object.entries(byConn)) {
        for (const d of arr) {
          const name = d.DeviceName || "iPhone"
          const cls = d.DeviceClass || ""
          const ios = d.ProductVersion || ""
          const model = d.ProductType || ""
          const label = `${connType} · ${name}${cls ? ` (${cls})` : ""}${ios ? ` · iOS ${ios}` : ""}${model ? ` · ${model}` : ""}`

          opts.push({ udid, connType, ios_version: ios || undefined, label })
        }
      }
    }

    opts.sort((a, b) => {
      const rank = (x: string) => (x === "USB" ? 0 : 1)
      const r = rank(a.connType) - rank(b.connType)
      if (r !== 0) return r
      return a.label.localeCompare(b.label)
    })

    return opts
  }, [devicesRaw])

  async function refresh() {
    setStatus("")
    setLoading(true)
    try {
      const data = await callBackend<DevicesResponse>("/api/devices", { method: "GET" })
      setDevicesRaw(data)

      if (!selected) {
        const first = (() => {
          for (const [udid, byConn] of Object.entries(data)) {
            for (const [connType, arr] of Object.entries(byConn)) {
              const d = arr?.[0]
              if (!d) continue
              const name = d.DeviceName || "iPhone"
              const ios = d.ProductVersion || ""
              const model = d.ProductType || ""
              const label = `${connType} · ${name}${ios ? ` · iOS ${ios}` : ""}${model ? ` · ${model}` : ""}`
              return { udid, connType, ios_version: ios || undefined, label } as SelectedDevice
            }
          }
          return null
        })()
        if (first) setSelected(first)
      }
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to load devices")
      setDevicesRaw(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { loading, status, setStatus, deviceOptions, selected, setSelected, refresh }
}