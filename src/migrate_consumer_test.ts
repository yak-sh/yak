// The FUNCTIONAL consumer arbiter for the eid→id storage reshape (T-19881,
// landmine C-19763). migrate_parity_test.ts certifies the STORAGE CORE
// (open()/apply()/snapshot()) — it imports only db.ts and never runs a CONSUMER
// path. But the dominant silent-corruption surface at cutover is the ~28
// consumers that filter by a REFERENCE column: post-flip an appended
// `where <refcol> = <eidValue>` binds the base int column (now an id), NOT the
// projected `refjoin.eid as <refcol>` alias — SQLite prefers a base column over
// an output alias — so the query returns NOTHING with no error. A green
// deno-check over a join that matches nothing. The fast tier can't see it (pure
// seams; sessions/heal/deliver/roles/closing/entries are probe-verified, not
// fast-tested) and the type checker can't parse a SQL template string. Only
// running a consumer against real data catches this class.
//
// So this boots the REAL server and drives closing.ts end to end — the closing
// effect runs `select eid from comment where target = ?` (closing.ts, a
// reference-column filter over comment.target, an {eid} ref) to find the
// correspondence a closed task should archive. Close a task that has a comment
// aimed at it; the comment must become archived. GREEN today — the plumbing
// works, which proves the harness itself runs and the boot is sound — so that
// post-flip a wrong `target` binding leaves the comment un-archived and this
// turns RED. That is the whole point: a functional path that can go red on the
// binding the parity harness structurally cannot see.
//
// slow() + a server boot on an ephemeral port — the precondition_test.ts
// pattern, the one heavy boot reached only over HTTP and only under TASKS_SLOW.
import { slow, until } from './testing.ts'
import { assertEquals } from '@std/assert'

// DB_PATH must be set before db.ts is imported (its module-init opens the
// default graph); a throwaway :memory: keeps that import off any real file, and
// the server boots on its own fresh in-memory graph.
Deno.env.set('DB_PATH', ':memory:')
await import('./db.ts')

// The server serves on import. Every test here is slow(), so the fast run (which
// ignores them all) must never pay that boot nor claim a socket a parallel
// worker would collide on: boot only under the heavy tier, on an ephemeral port
// handed back before the server takes it.
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`
}

let uid = () => crypto.randomUUID()
// The server boot leaves its listener, watchers and timers open for the process
// lifetime — the sanitizers would flag them, so opt out as precondition_test.ts
// does; the boot is the point, not a leak.
let alone = { sanitizeOps: false, sanitizeResources: false }

let post = (changes: unknown[]) =>
  fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  }).then((r) => r.text())

// Read the stored graph through a door of its own, so "the consumer archived it"
// rests on the graph, not on the response of the write under test.
let snap = () =>
  fetch(`http://${U}/snapshot`).then((r) => r.json()).then((o) =>
    (o as { changes: { eid: string; name: string }[] }).changes
  )

let archived = async (eid: string) =>
  (await snap()).some((c) => c.eid == eid && c.name == 'archived')

slow(
  'consumer: closing a task archives its correspondence (a ref-column filter)',
  alone,
  async () => {
    let task = uid(), note = uid()
    // A task, and a comment aimed AT the task — comment.target = task is the
    // {eid} reference the closing consumer filters on.
    await post([
      { eid: task, name: 'doc', comp: { title: 'closes soon' } },
      { eid: task, name: 'task', comp: { status: 'open' } },
      { eid: note, name: 'doc', comp: { title: '', body: 'about the task' } },
      { eid: note, name: 'comment', comp: { target: task } },
    ])
    assertEquals(
      await archived(note),
      false,
      'the comment was archived before the close — the setup is wrong',
    )

    // Close the task. closingTask fires as an effect and runs, in essence,
    //   select eid from comment where target = <task>
    // to find what to archive. Post-flip a wrong binding matches nothing here.
    await post([{ eid: task, name: 'task', comp: { status: 'done' } }])

    // The comment about the now-closed task must be archived. If the reference
    // filter silently matched nothing (the C-19763 landmine), this never turns
    // true and until() times out — RED, on exactly the surface the parity
    // harness cannot reach.
    await until(() => archived(note), {
      label: 'the comment about the closed task to be archived',
    })
  },
)
