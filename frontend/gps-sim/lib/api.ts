// app/lib/api.ts
export async function callBackend<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  })

  const text = await res.text()

  let data: any = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.message ||
      data?.detail ||
      `${res.status} ${text || res.statusText}`

    const err = new Error(message) as Error & {
      status?: number
      data?: any
    }

    err.status = res.status
    err.data = data
    throw err
  }

  return data as T
}