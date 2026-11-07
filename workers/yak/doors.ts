import type { Handler } from './env.ts'

// Doors loaded when a request first reaches one (T-37977). What they import —
// the MCP SDK and zod, the OAuth provider — was evaluated by every cold start,
// a Store waking for one query included; now only by an isolate that serves
// one of them. The shared JSON Schema validator still belongs to store
// admission, not this boundary. The email handler loads inbox.ts (postal-mime)
// the same way.
export let identity: Handler = async (req, env) =>
  (await import('./identity.ts')).fetch(req, env)
export let mcp: Handler = async (req, env) =>
  (await import('./mcp.ts')).fetch(req, env)
