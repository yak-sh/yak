// Closing a task closes its correspondence — and only what was already
// waiting. Against an in-memory db, no server.
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, open } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { closingTask } = await import('./closing.ts')
let { assertEquals } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)
let close = closingTask(cast)

let hidden = (eid: string) =>
  !!db.prepare(
    'select 1 from archived where entity = (select id from entity where eid = ?)',
  ).get(eid)

let task = () => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'a task' } },
    { eid, name: 'task', comp: { priority: 0 } },
  ])
  return eid
}
let about = (target: string, name: 'comment' | 'mail') => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: '', body: 'words' } },
    {
      eid,
      name,
      comp: { target: target },
    },
  ])
  return eid
}

Deno.test('closing a task archives the letters and comments about it', () => {
  let t = task()
  let c = about(t, 'comment'), m = about(t, 'mail')
  // an item about ANOTHER task is untouched — the effect is scoped by target
  let other = task(), oc = about(other, 'comment')
  close(t, {})
  assertEquals([hidden(c), hidden(m), hidden(oc)], [true, true, false])
  // the archive rode the wire, so open clients drop the items too
  // (apply re-reads each presence stamp onto the return, hence the set)
  assertEquals(
    [
      ...new Set(
        sent.filter((s) => s.name == 'archived').map((s) => s.eid),
      ),
    ].sort(),
    [c, m].sort(),
  )
})

// Status is derived now (D-24102): closingTask fires only when a `completed`
// or `cancelled` mark lands (doing.ts), so reaching it IS a terminal close —
// there is no non-terminal call to guard against. The effect archives whenever
// invoked; the mark that invoked it (done or cancelled alike) ends the task.
Deno.test('reaching the close effect archives the correspondence', () => {
  let t = task()
  let c = about(t, 'comment')
  close(t, {})
  assertEquals(hidden(c), true)
})

// The reason this is an effect and not a derived predicate: a letter
// questioning a closure arrives AFTER it, and must be seen. Deriving it
// from the target's status would make that letter invisible at birth.
Deno.test('correspondence that arrives after the close stays visible', () => {
  let t = task()
  close(t, {})
  let late = about(t, 'mail')
  assertEquals(hidden(late), false)
  // Closing again closes the correspondence again — the act is what
  // archives, so a deliberate re-close sweeps what has arrived since.
  // Nothing is lost: `task inbox --all` is where it went.
  close(t, {})
  assertEquals(hidden(late), true)
})
