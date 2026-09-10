// Fast guard for the production boot relay and fleet-journal boundary. Worldly
// handlers are stubs; the processPending query and committed trace are real.
import { assertEquals } from '@std/assert'
import { apply, sweepRows } from './db.ts'
import { db } from './live_db.ts'
import { replayDoing, splitEffects } from './doing.ts'
import { processPending } from './sessions.ts'
import { writeSession } from './session_store.ts'
import { delivered, PENDING } from './deliver.ts'
import { catchup } from './catchup.ts'
import { configureEffects, dispatch, fed, on, relay } from './effects.ts'

Deno.test('daemon boot reconciles each pending effect once; server owns no do effects', async () => {
  let env = Deno.env.get('TASKS_EFFECTS')
  Deno.env.set('TASKS_EFFECTS', 'daemon')
  let calls: string[] = []
  let session = crypto.randomUUID(),
    web = crypto.randomUUID(),
    later = crypto.randomUUID()
  on('session', {
    sweep: { pending: processPending },
    created: (eid) => {
      calls.push(`spawn ${eid}`)
      writeSession(db, eid, { started_at: new Date().toISOString() })
    },
  })
  on('web', {
    sweep: { pending: PENDING('web') },
    created: (eid) => {
      calls.push(`web ${eid}`)
      delivered(eid, 'probe', () => {})
    },
  })
  on('web', { where: 'serve', created: () => calls.push('serve') })
  // Committed before the cursor existed: boot owns this post-commit crash gap.
  apply(db, [
    {
      eid: session,
      name: 'session',
      comp: { id: session, provider: 'claude' },
    },
    { eid: web, name: 'web', comp: { url: 'https://example.test' } },
  ], fed())
  let feed = catchup(db, (r) => {
    if (r.trace) dispatch(r.batch, r.trace)
  })
  let restore = configureEffects({
    split: splitEffects(),
    want: splitEffects() ? (w) => w == 'serve' : () => true,
    settle: feed.settle,
  })
  try {
    let rows = (comp: string, pending: string) => sweepRows(db, comp, pending)
    await relay(rows)
    assertEquals(calls, [], 'server default ownership refuses every do sweep')
    let first = await replayDoing(rows)
    assertEquals(first, { spawns: 1, fired: 2 })
    assertEquals(calls, [`spawn ${session}`, `web ${web}`])
    assertEquals(await replayDoing(rows), { spawns: 0, fired: 0 })
    feed.settle()
    assertEquals(calls.length, 2, 'history is never re-dispatched after boot')
    apply(db, [{
      eid: later,
      name: 'web',
      comp: { url: 'https://example.test/later' },
    }], fed())
    feed.settle()
    assertEquals(calls.at(-1), 'serve')
    assertEquals(calls.length, 3, 'server feed did not run the do sibling')
    assertEquals(await replayDoing(rows), { spawns: 0, fired: 1 })
    assertEquals(calls.at(-1), `web ${later}`)
  } finally {
    restore()
    if (env === undefined) Deno.env.delete('TASKS_EFFECTS')
    else Deno.env.set('TASKS_EFFECTS', env)
    apply(
      db,
      [session, web, later].map((eid) => ({ eid, name: 'entity', comp: null })),
    )
  }
})
