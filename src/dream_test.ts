// dream.ts's seams: the JSONL→changes parse, the floor advance/clamp math, the
// consider-task shape, and the dreamComb effect driven with an INJECTED
// complete so no provider ever spawns (the recall_test recallFn pattern). The
// shared :memory: db carries other tests' rows, so every db assertion screens
// to the eids this test made.
Deno.env.set('DB_PATH', ':memory:')
let { apply, db } = await import('./db.ts')
let {
  advance,
  considerChanges,
  dreamComb,
  findingKey,
  namesResolved,
  parseFindings,
  seedWake,
  unwoken,
} = await import('./dream.ts')
let { assertEquals } = await import('@std/assert')

let uid = () => crypto.randomUUID()
let DAY = 86_400_000
let ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
let noop = () => {}
let says = (reply: string | null) => () => Promise.resolve(reply)

let proj = (title: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title, body: '' } },
    { eid, name: 'project', comp: {} },
  ])
  return eid
}
let dreamEnt = (scope: string, floor: string) => {
  let eid = uid()
  apply(db, [{ eid, name: 'dream', comp: { scope, floor } }])
  return eid
}
// A finished session belongs to a venture by its actor (not cwd) — insert the
// server-owned finished_at/actor directly, the way recall_test seeds sessions.
let sess = (actor: string, finished: string) => {
  let eid = uid()
  let id = uid()
  db.prepare('insert into entity (eid, num) values (?, ?)').run(
    eid,
    Math.floor(Math.random() * 1e9),
  )
  db.prepare(
    'insert into session (eid, id, actor, finished_at) values (?, ?, ?, ?)',
  ).run(eid, id, actor, finished)
  return { eid, id }
}
let msg = (session: string, text: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'entry', comp: { session } },
    { eid, name: 'message', comp: { role: 'agent' } },
    { eid, name: 'content', comp: { body: text } },
  ])
  return eid
}
let knock = (to: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'knock', comp: { target: to } },
    { eid, name: 'deliver', comp: { to } },
  ])
  return eid
}
let task = (title: string, status: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title, body: '' } },
    { eid, name: 'task', comp: { status } },
  ])
  let num = (db.prepare('select num from entity where eid = ?').get(eid) as {
    num: number
  }).num
  return { eid, num }
}

Deno.test('parseFindings: parses JSON Lines, skips junk, unknown kinds, and titleless', () => {
  let reply = [
    '{"kind":"gap","title":"a","body":"b","priority":2}',
    'not json at all',
    '```json', // a fence line — not an object
    '{"kind":"bogus","title":"x"}', // unknown kind
    '{"kind":"reflex","title":"y"}', // no priority → default 3, no body → ''
    '{"kind":"decision","title":"z","decided":"2026-01-01"}',
    '{"kind":"gap"}', // no title → skipped
  ].join('\n')
  let f = parseFindings(reply)
  assertEquals(f.length, 3)
  assertEquals(f[0], { kind: 'gap', title: 'a', body: 'b', priority: 2 })
  assertEquals(f[1], { kind: 'reflex', title: 'y', body: '', priority: 3 })
  assertEquals(f[2].kind, 'decision')
  assertEquals(f[2].decided, '2026-01-01')
})

Deno.test('advance: one day forward, held to the max(20 entries, 7 days) window', () => {
  let now = Date.parse('2026-08-12T00:00:00.000Z')
  let iso = (ms: number) => new Date(ms).toISOString()
  // Far-back floor: +1 day, since 7-days-ago is later and no 20th entry.
  assertEquals(
    advance('P', iso(now - 30 * DAY), now, undefined),
    iso(now - 29 * DAY),
  )
  // Close floor: clamped back to now-7d — the window never shrinks below 7 days.
  assertEquals(
    advance('P', iso(now - 2 * DAY), now, undefined),
    iso(now - 7 * DAY),
  )
  // A 20th entry older than both pulls the floor further back still.
  let twenty = iso(now - 40 * DAY)
  assertEquals(advance('P', iso(now - 2 * DAY), now, twenty), twenty)
})

Deno.test('considerChanges: a drift finding becomes a consider task about its source', () => {
  let cs = considerChanges(
    {
      kind: 'gap',
      title: 'add a delete verb',
      body: 'no warm path',
      priority: 2,
    },
    'p-eid',
    's-eid',
  )
  assertEquals(
    String(cs.find((c) => c.name == 'doc')!.comp!.title),
    'consider: add a delete verb',
  )
  let task = cs.find((c) => c.name == 'task')!.comp!
  assertEquals(task.status, 'open')
  assertEquals(task.priority, 2)
  assertEquals(task.project, 'p-eid')
  let edge = cs.find((c) => c.name == 'dependency')!.comp!
  assertEquals(edge.type, 'about')
  assertEquals(edge.child, 's-eid')
})

Deno.test('unwoken/seedWake: a dream with no pending wake is seeded once, then left alone', () => {
  let p = proj('Seed venture')
  let d = dreamEnt(p, ago(30))
  // The boot seed lists it and hands one wake.
  assertEquals(unwoken().includes(d), true)
  let seed = seedWake(d)
  assertEquals(seed.length, 2) // the wake and its deliver.to, one shared eid
  apply(db, seed)
  // Now it has a pending wake — no longer unwoken, and seedWake declines.
  assertEquals(unwoken().includes(d), false)
  assertEquals(seedWake(d).length, 0)
})

Deno.test('dreamComb: a dream knock combs the venture, files a consider task, advances the floor, re-arms', async () => {
  let p = proj('Dream test venture')
  let d = dreamEnt(p, ago(30))
  let s = sess(p, ago(2))
  msg(s.eid, 'reached for a delete verb that did not exist')
  let k = knock(d)
  let fake = says(
    JSON.stringify({
      kind: 'gap',
      title: 'add a delete verb',
      body: 'no warm path to remove',
      priority: 2,
    }),
  )
  await dreamComb(noop, fake as never)(k)

  // The knock settled DELIVERED — dreamComb owns its own stamp.
  assertEquals(
    !!db.prepare('select 1 from delivered where eid = ?').get(k),
    true,
  )
  // A consider task, about the combed session, in the venture.
  let task = db.prepare(
    `select t.status, t.project, doc.title from task t
       join doc on doc.eid = t.eid
       join dependency dep on dep.parent = t.eid
      where dep.type = 'about' and dep.child = ?`,
  ).get(s.eid) as { status: string; project: string; title: string } | undefined
  assertEquals(task?.status, 'open')
  assertEquals(task?.project, p)
  assertEquals(task?.title.startsWith('consider:'), true)
  // The floor advanced past its start.
  let floor = (db.prepare('select floor from dream where eid = ?').get(d) as {
    floor: string
  }).floor
  assertEquals(floor > ago(30), true)
  // Re-armed: an untargeted cadence wake aimed back at the dream.
  let wake = db.prepare(
    `select 1 from wake w join deliver dv on dv.eid = w.eid
      where dv."to" = ? and w.target is null`,
  ).get(d)
  assertEquals(!!wake, true)
})

Deno.test('dreamComb: a non-dream knock is ignored — no comb, no delivered', async () => {
  let p = proj('Not a dream')
  sess(p, ago(1))
  let k = knock(p) // aimed at the project, which is not a dream
  let called = false
  let fake = () => {
    called = true
    return Promise.resolve(null)
  }
  await dreamComb(noop, fake as never)(k)
  assertEquals(called, false)
  assertEquals(
    !!db.prepare('select 1 from delivered where eid = ?').get(k),
    false,
  )
})

Deno.test('dreamComb: a decision finding is captured as a memory, dated when taken', async () => {
  let p = proj('Decision venture')
  let d = dreamEnt(p, ago(30))
  let s = sess(p, ago(2))
  msg(s.eid, 'the owner decided to ADAPT complete() over a batch API')
  let k = knock(d)
  let fake = says(
    JSON.stringify({
      kind: 'decision',
      title: 'ADAPT complete() over batch',
      body: 'reuse the runner; batch is a later optimization',
      decided: '2026-08-10',
    }),
  )
  await dreamComb(noop, fake as never)(k)
  let mem = db.prepare(
    `select dc.at as decided from memory m
       join doc on doc.eid = m.eid
       join decided dc on dc.eid = m.eid
      where doc.title = ?`,
  ).get('ADAPT complete() over batch') as { decided: string } | undefined
  assertEquals(!!mem, true)
  assertEquals(mem!.decided.startsWith('2026-08-10'), true)
})

Deno.test('findingKey: kind + normalized title — ids/nums fold, kind splits', () => {
  let a = findingKey({
    kind: 'gap',
    title: 'add T-3 delete verb 5',
    body: 'x',
    priority: 3,
  })
  let b = findingKey({
    kind: 'gap',
    title: 'add T-99 delete verb 12',
    body: 'y',
    priority: 3,
  })
  assertEquals(a, b) // ids and bare numbers normalize to the same shape
  let c = findingKey({
    kind: 'entropy',
    title: 'add delete verb',
    body: '',
    priority: 3,
  })
  assertEquals(a == c, false) // kind is part of the key
})

Deno.test('namesResolved: true only when a finding names a closed task', () => {
  let done = task('a settled thing', 'done')
  let open = task('an open thing', 'open')
  let f = (body: string) => ({ kind: 'gap', title: 'x', body, priority: 3 })
  assertEquals(namesResolved(f(`already tracked as T-${done.num}`)), true)
  assertEquals(namesResolved(f(`see T-${open.num}`)), false)
  assertEquals(namesResolved(f('no ids in this body at all')), false)
})

Deno.test('dreamComb: dedup — a recurring finding hit-counts, never re-files', async () => {
  let p = proj('Dedup venture')
  let d = dreamEnt(p, ago(30))
  let s = sess(p, ago(2))
  msg(s.eid, 'reached for a frobnicate verb that did not exist')
  let reply = says(JSON.stringify({
    kind: 'gap',
    title: 'add a frobnicate verb',
    body: 'no warm path',
    priority: 3,
  }))
  // Two runs re-comb the same session (the floor clamps back inside 7 days).
  await dreamComb(noop, reply as never)(knock(d))
  await dreamComb(noop, reply as never)(knock(d))
  // Exactly ONE consider task about this session, its finding hit-counted to 2.
  let hits = db.prepare(
    `select fd.hits as hits from finding fd
       join dependency dep on dep.parent = fd.eid
      where dep.type = 'about' and dep.child = ?`,
  ).all(s.eid) as { hits: number }[]
  assertEquals(hits.length, 1)
  assertEquals(hits[0].hits, 2)
})

Deno.test('dreamComb: skip — a finding naming a resolved task is not filed', async () => {
  let p = proj('Skip venture')
  let d = dreamEnt(p, ago(30))
  let s = sess(p, ago(2))
  let done = task('the work this finding restates', 'done')
  msg(s.eid, 'we should verify through the production door')
  let reply = says(JSON.stringify({
    kind: 'gap',
    title: 'verify through the production door',
    body: `already tracked as T-${done.num}`,
    priority: 3,
  }))
  await dreamComb(noop, reply as never)(knock(d))
  // No consider task filed about this session — the finding named closed work.
  let n = db.prepare(
    `select count(*) as n from dependency dep
      where dep.type = 'about' and dep.child = ?
        and exists (select 1 from task t where t.eid = dep.parent)`,
  ).get(s.eid) as { n: number }
  assertEquals(n.n, 0)
})

Deno.test('dreamComb: a reflex finding becomes a venture memory, not a consider task', async () => {
  let p = proj('Reflex venture')
  let d = dreamEnt(p, ago(30))
  let s = sess(p, ago(2))
  msg(s.eid, 'escalated a decidable question again')
  let title = 'stop escalating reversible decisions'
  let reply = says(JSON.stringify({
    kind: 'reflex',
    title,
    body: 'a reversible call parked is costlier than a wrong one corrected',
    priority: 2,
  }))
  await dreamComb(noop, reply as never)(knock(d))
  // A memory, scoped to the venture; no "consider:" task with that title.
  let mem = db.prepare(
    `select m.scope as scope from memory m join doc on doc.eid = m.eid
      where doc.title = ?`,
  ).get(title) as { scope: string } | undefined
  assertEquals(!!mem, true)
  assertEquals(mem!.scope, p)
  let considers = db.prepare('select count(*) as n from doc where title = ?')
    .get(`consider: ${title}`) as { n: number }
  assertEquals(considers.n, 0)
})

Deno.test('dreamComb: two sessions, one shared finding — filed once (batch + within-run dedup)', async () => {
  let p = proj('Batch venture')
  let d = dreamEnt(p, ago(30))
  let s1 = sess(p, ago(3))
  msg(s1.eid, 'first session touched the widget path')
  let s2 = sess(p, ago(2))
  msg(s2.eid, 'second session touched the widget path')
  let reply = says(JSON.stringify({
    kind: 'gap',
    title: 'unify the widget path',
    body: 'both sessions reinvented it',
    priority: 3,
  }))
  await dreamComb(noop, reply as never)(knock(d))
  // Both sessions combed, but the shared finding lands ONE task, not two.
  let considers = db.prepare('select count(*) as n from doc where title = ?')
    .get('consider: unify the widget path') as { n: number }
  assertEquals(considers.n, 1)
})
