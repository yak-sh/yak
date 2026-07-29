// The obey seam: which comments carry an order, what the order does to
// its target, and what comes back — against an in-memory db, driven the
// way production drives it (apply, then dispatch the effect).
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { obeyed } = await import('./obey.ts')
let { assertEquals, assertMatch } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let heard: { eid: string; name: string; comp: unknown }[] = []
let cast = (cs: typeof heard) => heard.push(...cs)
let obey = obeyed(cast)

// A comment as any door writes it — landed, then handed to the effect
// with the comp apply() committed.
let say = (target: string, body: string, via?: string, event?: number) => {
  let eid = uid()
  let comp: Record<string, unknown> = { target_eid: target }
  if (event) comp.event = event
  apply(
    db,
    [
      { eid, name: 'doc', comp: { title: '', body } },
      { eid, name: 'comment', comp },
    ],
    undefined,
    via,
  )
  obey(eid, comp)
  return eid
}

let task = (title = 'A thing to do') => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title } },
    { eid, name: 'task', comp: { status: 'open' } },
  ])
  return eid
}

let status = (eid: string) =>
  (db.prepare('select status from task where eid = ?').get(eid) as
    | { status: string }
    | undefined)?.status

// Every comment aimed at the target, oldest first, with its event flag —
// the receipts are in here, and nothing else should be.
let replies = (target: string) =>
  db.prepare(
    `select d.body, c.event from comment c join doc d on d.eid = c.eid
     where c.target_eid = ? order by c.rowid`,
  ).all(target) as { body: string; event: number | null }[]

Deno.test('a comment that says :done closes the task it was said on', () => {
  let t = task()
  say(t, ':done')
  assertEquals(status(t), 'done')
  // The order landed as the record of the ask; the answer is subordinate.
  let said = replies(t)
  assertEquals(said.length, 2)
  assertEquals(said[0].body, ':done')
  assertEquals(said[0].event, null)
  assertMatch(said[1].body, /done/)
  assertEquals(said[1].event, 1)
})

Deno.test('the order rides with its prose, and the prose stays put', () => {
  let t = task()
  say(t, ':wip\n\nStarting on this now — the parser is the hard half.')
  assertEquals(status(t), 'wip')
  assertMatch(replies(t)[0].body, /parser is the hard half/)
})

Deno.test('a receipt never commands — that is the loop floor', () => {
  let t = task()
  say(t, ':done', undefined, 1) // the server speaking
  assertEquals(status(t), 'open')
  assertEquals(replies(t).length, 1) // no answer to an event
})

Deno.test('prose is never an order', () => {
  let t = task()
  say(t, 'we should probably call this one done')
  say(t, ' :done')
  assertEquals(status(t), 'open')
  assertEquals(replies(t).length, 2) // both landed, neither ran
})

Deno.test('a refusal is taught where the order was given', () => {
  let t = task()
  say(t, ':dnoe')
  assertEquals(status(t), 'open')
  let said = replies(t)
  assertEquals(said.length, 2)
  assertMatch(said[1].body, /not a command: dnoe/)
  assertEquals(said[1].event, 1)
})

Deno.test('a bad order changes nothing — the refusal is the only write', () => {
  let t = task()
  // :set patches; a param that names no column must not half-apply.
  say(t, ':set .nonsense=1')
  assertEquals(status(t), 'open')
  assertMatch(replies(t)[1].body, /unknown prop: \.nonsense/)
})

Deno.test('the order is attributed to whoever gave it', () => {
  let t = task()
  let s = uid()
  apply(db, [{ eid: s, name: 'session', comp: { id: uid() } }])
  say(t, ':done', s)
  assertEquals(status(t), 'done')
  let by = db.prepare(
    `select u.via from updated u where u.eid = ?`,
  ).get(t) as { via: string | null } | undefined
  assertEquals(by?.via, s)
})

Deno.test('the answer rides the wire, so every screen sees it', () => {
  let t = task()
  heard = []
  say(t, ':done')
  assertEquals(heard.some((c) => c.name == 'task'), true)
  assertEquals(heard.some((c) => c.name == 'comment'), true)
})
