// The host seam (D-32318): what the server asks of the process that runs it,
// and nothing more. `serve` binds a port to a plain request handler, `upgrade`
// turns one request into a socket, `onSignal` hears the operator's stop. The
// route table in server_runtime.ts is written against this shape; host_deno.ts
// is the first adapter, a Worker the second. The per-socket Deno Worker
// readers, sucrase at request time, and the watchFs hot reload are that
// adapter's conveniences, never asked of a host here — /ws and /apply speak
// the same frames over any of them.
export type Handler = (req: Request) => Response | Promise<Response>

export type Listener = {
  addr: { hostname: string; port: number }
  shutdown: () => Promise<void>
}

export type Host = {
  serve: (port: number, handle: Handler) => Listener
  upgrade: (req: Request) => { socket: WebSocket; response: Response }
  onSignal: (sig: 'SIGINT' | 'SIGTERM', fn: () => void) => void
}
