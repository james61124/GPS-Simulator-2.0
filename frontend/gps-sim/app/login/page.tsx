"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  startDesktopLogin,
  pollDesktopLoginTicket,
  exchangeDesktopLogin,
} from "@/lib/auth-client"

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false

    async function poll() {
      try {
        const { ticket } = await pollDesktopLoginTicket()
        if (!ticket || stopped) return

        await exchangeDesktopLogin(ticket)
        window.location.href = "/"
        // router.replace("/")
        // router.refresh()
      } catch (e: any) {
        if (!stopped) {
          setError(e?.message ?? "Desktop login exchange failed")
          setLoading(false)
        }
      }
    }

    timer = setInterval(poll, 1000)

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
    }
  }, [router])

  async function handleLogin() {
    setLoading(true)
    setError("")

    try {
      await startDesktopLogin()
    } catch (e: any) {
      setError(e?.message ?? "Failed to open browser")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Login required</h1>
        <p className="mt-2 text-sm text-slate-600">
          Continue in your browser to sign in with Google
        </p>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Waiting for browser login..." : "Continue with Google"}
        </button>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </main>
  )
}