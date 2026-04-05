/** Base URL for Next.js server → Django (rewrites, Route Handlers). Not exposed to the browser. */
export function internalDjangoUrl(): string {
  return (
    process.env.INTERNAL_DJANGO_URL ||
    process.env.BACKEND_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "")
}
