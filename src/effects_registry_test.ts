// The registry against the vocabulary: every `changed:` handler names a
// REAL column of its component. A changed handler fires only when its
// column is `in` the applied comp (effects.ts dispatch), so one naming a
// column that doesn't exist can never fire — it looks live and isn't,
// the same decoy class that let persona sync watch `project` (a
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
import { slow } from './testing.ts'

// The audit needs server.ts's top-level `on()` registrations, and server.ts
// serves on import — so this is slow(): the fast run skips it rather than boot a
// real server (and claim a socket a parallel worker would collide on). The boot
// is what registers the effects; we read the registry, never the socket.
Deno.env.set('DB_PATH', ':memory:')
if (Deno.env.get('TASKS_SLOW')) {
  Deno.env.set('PORT', '0')
  await import('./server.ts')
}

// Every column a component actually has: wire-writable (comps) plus
// server-stamped (stamped) — both ride the applied comp dispatch sees, so
// either is a legitimate thing to watch.
let cols = (comp: string) => ({
  ...comps[comp],
  ...stamped[comp],
})

slow('every changed: handler names a real column of its component', () => {
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
