import { NextResponse } from "next/server"

import { internalDjangoUrl } from "@/lib/internal-django"

export async function POST(req: Request) {
  try {
    const { idToken } = await req.json()

    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken" }, { status: 400 })
    }

    const backendRes = await fetch(`${internalDjangoUrl()}/api/auth/google`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idToken }),
      credentials: "include",
    })

    const data = await backendRes.json().catch(() => ({}))
    const response = NextResponse.json(data, { status: backendRes.status })

    const setCookie = backendRes.headers.get("set-cookie")
    if (setCookie) {
      response.headers.set("set-cookie", setCookie)
    }

    return response
  } catch {
    return NextResponse.json({ error: "Unexpected login error" }, { status: 500 })
  }
}