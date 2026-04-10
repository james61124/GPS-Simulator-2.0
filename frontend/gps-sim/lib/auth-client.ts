import { callCloud, callLocal, CLOUD_API_BASE } from "@/lib/api"
import { openUrl } from "@tauri-apps/plugin-opener"

export async function startDesktopLogin() {
  await openUrl(`${CLOUD_API_BASE}/api/auth/desktop/start`)
}

export async function pollDesktopLoginTicket() {
  return callLocal<{ ticket: string | null }>("/auth/pending", {
    method: "GET",
  })
}

export async function exchangeDesktopLogin(ticket: string) {
  const data = await callCloud("/api/auth/desktop/exchange", {
    method: "POST",
    body: JSON.stringify({ ticket }),
  })

  await callLocal("/auth/clear", {
    method: "POST",
  })

  return data
}

export async function logout() {
  return callCloud("/api/auth/logout", {
    method: "POST",
  })
}