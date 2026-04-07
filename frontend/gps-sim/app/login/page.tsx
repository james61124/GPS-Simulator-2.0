// app/login/page.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { loginWithGoogleIdToken } from "@/lib/auth-client"

declare global {
  interface Window {
    google?: any
  }
}

export default function LoginPage() {
  const router = useRouter()
  const buttonRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.defer = true
    document.body.appendChild(script)

    script.onload = () => {
      if (!window.google || !buttonRef.current) return

      window.google.accounts.id.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        callback: async (response: { credential?: string }) => {
          if (!response.credential) {
            setError("Google login failed")
            return
          }

          setLoading(true)
          setError("")

          try {
            await loginWithGoogleIdToken(response.credential)
            router.replace("/")
          } catch (e: any) {
            setError(e?.message ?? "Login failed")
          } finally {
            setLoading(false)
          }
        },
      })

      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        width: 260,
      })
    }

    return () => {
      document.body.removeChild(script)
    }
  }, [router])

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Login required</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with Google to continue using SprytePath
        </p>

        <div className="mt-6 flex justify-center">
          <div ref={buttonRef} />
        </div>

        {loading && (
          <div className="mt-4 text-center text-sm text-slate-600">
            Signing in...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </main>
  )
}