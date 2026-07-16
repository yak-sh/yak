// The browser half of the sync layer (sync.ts is the server half): one
// socket, one identity, one camera — shared by every island. This module is
// also evaluated during server render, so no browser APIs at the top level.
import { signal } from '@preact/signals'

// One socket per tab, lazily opened; sends queue behind the handshake.
let ws: WebSocket | null = null
export let sock = () => {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws
  ws = new WebSocket(`ws://${location.host}/ws`)
  return ws
}

export let send = (...changes: unknown[]) => {
  let s = sock()
  let msg = JSON.stringify(changes)
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}

// crypto.randomUUID is gated to secure contexts, and this page is reached
// over plain http on the tailnet — so mint v4 uuids from getRandomValues,
// which isn't gated.
export let uuid = () => {
  let b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  let h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`
}

// Who this browser is: a client entity, its uuid minted into localStorage on
// first visit. The db rows appear when the camera first persists.
export let clientId = () => {
  let id = localStorage.getItem('tasks-client')
  if (!id) {
    id = uuid()
    localStorage.setItem('tasks-client', id)
  }
  return id
}

// This tab's camera over the canvas it's viewing: x/y is the viewport CENTER
// in plane coords, w/h the viewport size in screen px. Shared so drags can
// convert screen px into plane px.
export let camera = signal({ x: 0, y: 0, zoom: 1, w: 0, h: 0 })
