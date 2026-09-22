/// <reference types="@cloudflare/workers-types/index.d.ts" />
// The shapes this package declares are slices of the runtime's own types. It
// names them structurally so nothing here depends on Cloudflare at runtime —
// and this file is where that claim is checked, against
// @cloudflare/workers-types itself. Every assertion is an assignment: if the
// runtime's types stop satisfying the slices, the check fails here rather than
// `wrangler deploy` failing later.
//
// It is checked on its own (`deno task check:workers`) and excluded from the
// repo-wide check, because @cloudflare/workers-types arrives as globals — the
// package declares them and exports nothing — and those globals merge into
// whatever program includes them, redefining `Response`, `WebSocket` and
// rest for every other file in it. One file includes them; the rest of the
// repo type-checks against the web. @yaks/workerd keeps the same gate.

import type { DurableSql, DurableStorage, SqlCursor, SqlValue } from './sql.ts'
import type { Hibernation, Wire } from './sockets.ts'
import type { Sockets } from './sockets.ts'
import { sockets, storage } from './mod.ts'
import type { Vocab } from '@yaks/vocab'
import type { Subs } from '@yaks/api'

let state = null as unknown as DurableObjectState

// Storage: `ctx.storage` is a `DurableStorage`, its `sql` is a `DurableSql`,
// and a cursor is what this package reads rows from.
let _storage: DurableStorage = state.storage
let _sql: DurableSql = state.storage.sql
let _cursor: SqlCursor<Record<string, SqlStorageValue>> =
  null as unknown as SqlStorageCursor<Record<string, SqlStorageValue>>
// Every value the driver converts to is one the engine takes.
let _value: SqlStorageValue = null as unknown as SqlValue

// Sockets: the object's own state accepts sockets, and the sockets it returns
// are `Wire`s.
let _ctx: Hibernation = state
let _wire: Wire = state.getWebSockets()[0]

// And the two entry points, called the way a Durable Object calls them.
let _store = (vocab: Vocab) => storage(state.storage, vocab)
let _live = (subs: Subs): Sockets => sockets(subs, state)
