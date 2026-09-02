// The Deno host: the first adapter behind host.ts, and all that `deno task
// dev` runs on. Deno.serve, Deno.upgradeWebSocket, and the process signal
// listeners, one line each — nothing here knows a route.
import type { Host } from './host.ts'

export let host: Host = {
  serve: (port, handle) => Deno.serve({ port }, handle),
  upgrade: (req) => Deno.upgradeWebSocket(req),
  onSignal: (sig, fn) => Deno.addSignalListener(sig, fn),
}
