// The obey seam: which comments carry an order, what the order does to
// its target, and what comes back — against an in-memory db, driven the
// way production drives it (apply, then dispatch the effect).
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { inert, obeyed } = await import('./obey.ts')
let { orderIn } = await import('./commands.ts')
let { assertEquals, assertMatch } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let heard: { eid: string; name: string; comp: unknown }[] = []
let cast = (cs: typeof heard) => heard.push(...cs)
let obey = obeyed(cast)

// A comment as any door writes it — landed, then handed to the effect
// with the comp apply() committed.
let say = (target: string, body: string, via?: string) => {
  let eid = uid()
  let comp: Record<string, unknown> = { target_eid: target }
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

// Every comment aimed at the target, oldest first — the receipts are in
// here, and nothing else should be.
let replies = (target: string) =>
  db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     where c.target_eid = ? order by c.rowid`,
  ).all(target) as { body: string }[]

Deno.test('a comment that says :done closes the task it was said on', () => {
  let t = task()
  say(t, ':done')
  assertEquals(status(t), 'done')
  // The order landed as the record of the ask; the answer is subordinate.
  let said = replies(t)
  assertEquals(said.length, 2)
  assertEquals(said[0].body, ':done')
  assertMatch(said[1].body, /done/)
})

Deno.test('the order rides with its prose, and the prose stays put', () => {
  let t = task()
  say(t, ':wip\n\nStarting on this now — the parser is the hard half.')
  assertEquals(status(t), 'wip')
  assertMatch(replies(t)[0].body, /parser is the hard half/)
})

// THE FLOOR: this effect reads comments AND mints them, so a receipt whose
// first line opened with ':' would obey itself forever. receipt() neutralises
// the body at the mint. No command's message starts that way today, which is
// precisely why the invariant is asserted rather than trusted — the day one
// does, this fails instead of hanging the server.
Deno.test('nothing this effect mints can itself be an order', () => {
  let t = task()
  say(t, ':done') // a receipt for an order that ran
  say(t, ':dnoe') // a receipt for one that was refused
  // Everything after each order is the effect's own words.
  let minted = replies(t).map((r) => r.body).filter((b) => !b.startsWith(':'))
  assertEquals(minted.length, 2) // the positive control: receipts DID land
  for (let body of minted) assertEquals(orderIn(body), '')

  // And the mechanism itself, which the loop above cannot exercise because
  // no command's message opens with ':' — so without this the assertion
  // above would pass whether or not the floor were there at all.
  assertEquals(orderIn(':done'), ':done') // what it must defuse
  assertEquals(inert(':done'), ' :done')
  assertEquals(orderIn(inert(':done')), '')
  assertEquals(inert('T-1 → done'), 'T-1 → done') // prose is untouched
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
