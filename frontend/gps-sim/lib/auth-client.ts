// lib/auth-client.ts
export async function loginWithGoogleIdToken(idToken: string) {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ idToken }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data?.error || "Login failed")
  }

  return data
}