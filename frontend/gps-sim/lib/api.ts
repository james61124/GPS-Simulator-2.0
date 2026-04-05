// app/lib/api.ts
export async function callBackend<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    })
  
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${text}`)
    return (text ? JSON.parse(text) : {}) as T
  }