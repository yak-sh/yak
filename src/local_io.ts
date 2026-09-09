// The in-process graph IO: every MCP tool's door onto a SQLite handle this
// process already holds. dbReads (mcp.ts) is the read half; the writes and the
// service-owned operations are here, because they need a journal settle and a
// cast. Two processes build one: the serving process for its mounted /mcp, and
// the effects daemon for the hosted Tasks tools the graph-native runner calls
// (T-35018). stdioIO is the third shape — remote writes over HTTP — and stays
// in mcp.ts beside its wire.
import { DatabaseSync } from './store/sqlite.ts'
import { type Mutation, mutationResult } from './mutation.ts'
import { mutate, touch } from './db.ts'
import { dbReads, type IO } from './mcp.ts'
import { store } from './freeze.ts'
import { requestVerifier } from './verify.ts'
import { fed } from './effects.ts'
import type { Change } from './types.ts'

export type LocalIO = {
  db: DatabaseSync
  // Broadcast a committed batch; a process with no sockets passes a no-op and
  // lets the serving process rebroadcast the journaled rows.
  cast: (changes: Change[]) => void
  // Hand the journal feed the commit that just landed, keeping this process's
  // own writes synchronously ordered.
  settle: () => void
  providers: IO['providers']
  // Why this process may not write, when it may not (the app-plane reader
  // holds no baton). Absent means it may.
  refuse?: () => string | undefined
}

export let localIO = (o: LocalIO): IO => {
  let deny = () => {
    let why = o.refuse?.()
    if (why) throw new Error(why)
  }
  return {
    // Local and stdio MCP share these exact SQLite readers. The remaining
    // capabilities below are service-owned mutations or external operations.
    ...dbReads(o.db),
    // deno-lint-ignore require-await
    write: async (mutation: Mutation, via) => {
      deny()
      let out = mutationResult(mutate(o.db, mutation, fed(), via))
      o.settle()
      return out
    },
    // deno-lint-ignore require-await
    verify: async (id, via) => {
      deny()
      return requestVerifier(o.cast, id, via)
    },
    upload: async (eid, html) => {
      deny()
      // store() journals its stamp (record); the feed carries it to the sockets.
      let res = await store(eid, html, o.settle)
      if (!res.ok) throw new Error(await res.text())
    },
    // The one writer of recall stats: stamp, then cast, so every cache hears
    // the new warmth (the apply wire refuses these rows). Warmth is a WRITE, so
    // a process that may not write skips it SILENTLY — a read must never fail
    // because it tried to bump recall stats. Touches are deliberately NOT
    // journaled (reading is not editing), so they cannot ride the feed: the
    // direct cast is their only delivery, live-only by design.
    // deno-lint-ignore require-await
    touch: async (eids, confirm) => {
      if (o.refuse?.()) return
      let out = touch(o.db, eids, confirm)
      if (out.length) o.cast(out)
    },
    providers: o.providers,
  }
}
