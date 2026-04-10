// hooks/useAuthGuard.ts
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { callCloud } from "@/lib/api"

type SessionResponse = {
  authenticated: boolean
  user?: {
    sub?: string
    email?: string
    name?: string
    picture?: string
  }
}

export function useAuthGuard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkSession() {
      try {
        const data = await callCloud<SessionResponse>("/api/auth/session", {
          method: "GET",
        })

        if (!cancelled) {
          setIsAuthenticated(!!data.authenticated)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setIsAuthenticated(false)
          setLoading(false)
        }
      }
    }

    checkSession()

    return () => {
      cancelled = true
    }
  }, [])

  function requireLogin() {
    if (!isAuthenticated) {
      router.push("/login")
      return false
    }
    return true
  }

  return {
    loading,
    isAuthenticated,
    requireLogin,
  }
}