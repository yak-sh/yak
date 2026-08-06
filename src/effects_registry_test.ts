// The registry against the vocabulary: every `changed:` handler names a
// REAL column of its component. A changed handler fires only when its
// column is `in` the applied comp (effects.ts dispatch), so one naming a
// column that doesn't exist can never fire — it looks live and isn't,
// the same decoy class that let persona sync watch `project_eid` (a
// column personas never had) and silently never re-render a re-home.
//
// The check derives from the registrations + the vocabulary, not a
// sample: importing server.ts runs its top-level `on()` calls, so the
// registry `docs()` reads back carries EVERY curated effect. A future
// handler naming a non-existent column fails the gate here. The
// registrations close over server internals (db, cast, the sync closure),
// so booting the module is the only way to make them introspectable —
// same ephemeral-port pattern precondition_test uses, and we read the
// registry, never the socket.
import { assert } from '@std/assert'
import { comps, stamped } from './types.ts'
import { docs } from './effects.ts'

// Give the server a free port and an in-memory graph, then let it boot —
// the boot is what registers the effects we're auditing.
let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
Deno.env.set('PORT', String((seat.addr as Deno.NetAddr).port))
seat.close()
Deno.env.set('DB_PATH', ':memory:')
await import('./server.ts')

// Every column a component actually has: wire-writable (comps) plus
// server-stamped (stamped) — both ride the applied comp dispatch sees, so
// either is a legitimate thing to watch.
let cols = (comp: string) => ({
  ...comps[comp],
  ...stamped[comp],
})

Deno.test('every changed: handler names a real column of its component', () => {
  for (let e of docs()) {
    for (let hook of e.hooks) {
      let col = hook.match(/^changed\((.+)\)$/)?.[1]
      if (!col) continue
      assert(
        col in cols(e.comp),
        `on('${e.comp}', { changed: { ${col} } }) watches a column ` +
          `'${e.comp}.${col}' that does not exist — the handler can ` +
          `never fire (effects.ts dispatch gates on \`col in comp\`)`,
      )
    }
  }
})
