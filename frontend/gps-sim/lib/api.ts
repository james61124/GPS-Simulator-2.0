// lib/api.ts

export const CLOUD_API_BASE =
  process.env.NEXT_PUBLIC_CLOUD_API_BASE || "http://127.0.0.1:8000"

export const LOCAL_API_BASE =
  process.env.NEXT_PUBLIC_LOCAL_API_BASE || "http://127.0.0.1:9100"

type ApiTarget = "cloud" | "local"

function buildUrl(target: ApiTarget, path: string) {
  if (/^https?:\/\//.test(path)) return path

  const base = target === "cloud" ? CLOUD_API_BASE : LOCAL_API_BASE
  const normalizedBase = base.replace(/\/$/, "")
  const normalizedPath = path.startsWith("/") ? path : `/${path}`

  return `${normalizedBase}${normalizedPath}`
}

export async function callBackend<T>(
  path: string,
  init?: RequestInit,
  target: ApiTarget = "cloud"
): Promise<T> {
  const res = await fetch(buildUrl(target, path), {
    ...init,
    credentials: target === "cloud" ? "include" : "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  })

  const text = await res.text()

  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const parsed = data as Record<string, unknown>

    const message =
      (typeof parsed?.error === "string" && parsed.error) ||
      (typeof parsed?.message === "string" && parsed.message) ||
      (typeof parsed?.detail === "string" && parsed.detail) ||
      `${res.status} ${text || res.statusText}`

    const err = new Error(message) as Error & {
      status?: number
      data?: unknown
    }

    err.status = res.status
    err.data = data
    throw err
  }

  return data as T
}

export function callCloud<T>(path: string, init?: RequestInit): Promise<T> {
  return callBackend<T>(path, init, "cloud")
}

export function callLocal<T>(path: string, init?: RequestInit): Promise<T> {
  return callBackend<T>(path, init, "local")
}