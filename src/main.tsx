import { render } from 'preact'
import { boot, clientId } from './live.ts'
import { App } from './components/App.tsx'

// Tell the server when this page breaks (the rows land in telemetry) — a
// crash nobody sees is a crash nobody fixes. Capped per page load: a
// render loop that throws every frame must not become a POST loop. Every
// failure here is swallowed, because the reporter must never become the
// bug it reports.
let left = 10
let report = (message: string, stack?: string) => {
  if (left-- <= 0) return
  try {
    fetch('/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        stack: stack?.slice(0, 2000),
        url: location.href,
        client_eid: clientId(),
      }),
    }).catch(() => {})
  } catch { /* no localStorage, no fetch — nothing worth a second crash */ }
}
addEventListener('error', (e) => report(e.message, e.error?.stack))
addEventListener('unhandledrejection', (e) => {
  report(String(e.reason?.message ?? e.reason), e.reason?.stack)
})

// Fill the cache, open the socket, render everything from it.
await boot()
render(<App />, document.body)
