/// <reference types="@cloudflare/workers-types/index.d.ts" />
// The Store Durable Object, held to the runtime's own types (T-33810).
// graph.ts names the slice of a `DurableObjectState` it needs structurally, so
// nothing in it depends on Cloudflare at runtime — and this file is where that
// claim is checked, against @cloudflare/workers-types itself. Every assertion
// is an assignment: if the runtime's types stop satisfying the class, the check
// fails here rather than `wrangler deploy` failing later.
//
// `deno task check:types` checks it in the Workers program, apart from Deno's, because @cloudflare/workers-types arrives as globals — the
// package declares them and exports nothing — and those globals merge into
// whatever program includes them, redefining `Response`, `WebSocket` and
// friends for every other file in it. @yaks/durable-object and @yaks/workerd
// keep the same gate, for the same reason.

import { type State, Store } from './graph.ts'

let ctx = null as unknown as DurableObjectState

// The object is constructed the way the runtime constructs it: with its own
// state, whole.
let _state: State = ctx
let store = new Store(ctx)

// And it answers the three handlers the runtime calls, with the runtime's own
// argument types.
let _fetch: (request: Request) => Response | Promise<Response> = (r) =>
  store.fetch(r)
let _message = (ws: WebSocket, data: string | ArrayBuffer): void | Promise<void> =>
  store.webSocketMessage(ws, data)
let _close = (ws: WebSocket): void | Promise<void> =>
  store.webSocketClose(ws)
