/// <reference types="@cloudflare/workers-types/index.d.ts" />
// The shapes this package declares are SLICES of the runtime's own types. It
// names them structurally so nothing here depends on Cloudflare at runtime —
// and this file is where that claim is checked, against
// @cloudflare/workers-types itself. Every assertion is an assignment: if the
// runtime's types stop satisfying the slices, the check fails here rather than
// `wrangler deploy` failing later.
//
// It is CHECKED ON ITS OWN (`deno task check:workers`) and excluded from the
// repo-wide check, because @cloudflare/workers-types arrives as GLOBALS — the
// package declares them and exports nothing — and those globals merge into
// whatever program includes them, redefining `Response`, `WebSocket` and
// friends for every other file in it. One file wears them; the rest of the repo
// type-checks against the web. @yaks/durable-object and @yaks/workers keep the
// same gate.
//
// The one shape that cannot be a narrow slice is the PREPARED STATEMENT: it is
// both what `prepare` returns and what `batch` takes, so a slice would have to
// be a supertype and a subtype of `D1PreparedStatement` at once. That is why
// ./d1.ts makes it a type parameter — the binding's own statement type is used
// as itself, and the assignment below is what proves the parameter binds.

import type { D1Like, D1Result, D1Value, Row, Stmt } from './d1.ts'
import { storage } from './mod.ts'
import type { Vocab } from '@yaks/vocab'
import type { Storage } from '@yaks/graph'

let db = null as unknown as D1Database

// The binding satisfies the surface, with the runtime's own statement type
// bound to the parameter.
let _db: D1Like<D1PreparedStatement> = db
// A runtime statement is the statement shape this adapter uses.
let _stmt: Stmt<D1PreparedStatement> = db.prepare('select 1')
// Every value the adapter binds is one the engine takes.
let _value: D1Value = null as unknown as ArrayBuffer | string | number | boolean
// A result carries its rows where the adapter reads them.
let _result: D1Result<Row> = null as unknown as D1Result<Row>
let _rows: Row[] = _result.results
// And the door, called the way a Worker calls it — answering the seam
// @yaks/graph applies changes through.
let _store = (vocab: Vocab): Storage => storage(db, vocab)
