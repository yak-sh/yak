// dream.ts's seams: the JSONL→changes parse, the floor advance/clamp math, the
// consider-task shape, and the dreamComb effect driven with an INJECTED
// complete so no provider ever spawns (the recall_test recallFn pattern). The
// shared :memory: db carries other tests' rows, so every db assertion screens
// to the eids this test made.
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let {
  advance,
  considerChanges,
  dreamComb,
  dreamRun,
  findingKey,
  namesResolved,
  nearestMemory,
  parseFindings,
  seedWake,
  unwoken,
} = await import('./dream.ts')
let { hash, MODEL } = await import('./embed.ts')
let { ownVector, refreshVector } = await import('./vector.ts')
// Sole writer of its own :memory: graph, so this process owns the quantize the
// way the embed sweep's process does (T-22622).
ownVector()
let { axes } = await import('./testvec.ts')
let { slow } = await import('./testing.ts')
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
    `insert into session (entity, id, actor, finished_at)
     values ((select id from entity where eid = ?), ?,
             (select id from entity where eid = ?), ?)`,
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
// Precomputed vectors for the semantic gate, the embed_test/recall_test way —
// the embedder never loads. A distinctive negative direction keeps these clear
// of every other test's first-quadrant vectors above the 0.78 dupe floor. The
// coordinates ride a dense basis (testvec.ts) at full dimensionality so the
// ANN index ranks them like real embeddings.
let vec = (...xs: number[]) => axes(...xs)
// Store the way the sweep does — write, then rebuild the ANN index. knn() is
// strictly read-only (T-22622), so an unquantized write is invisible to
// semantic search until whoever owns the index quantizes it.
let putVec = (eid: string, v: Float32Array) => {
  db.prepare(
    'insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)',
  ).run(eid, MODEL, hash(eid), new Uint8Array(v.buffer))
  refreshVector(db)
}
let memWithVec = (title: string, v: Float32Array) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title, body: '' } },
    { eid, name: 'memory', comp: { scope: null } },
  ])
  putVec(eid, v)
  return eid
}
let docWithVec = (title: string, v: Float32Array) => {
  let eid = uid()
  apply(db, [{ eid, name: 'doc', comp: { title, body: '' } }])
  putVec(eid, v)
  return eid
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

slow(
  'dreamComb: a dream knock combs the venture, files a consider task, advances the floor, re-arms',
  async () => {
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
      !!db.prepare(
        'select 1 from delivered where entity = (select id from entity where eid = ?)',
      ).get(k),
      true,
    )
    // A consider task, about the combed session, in the venture.
    let task = db.prepare(
      `select t.status, (select eid from entity where id = t.project) as project,
              doc.title from task t
       join doc_value doc on doc.entity = t.entity
       join dependency dep on dep.parent = t.entity
      where dep.type = 'about' and dep.child = (select id from entity where eid = ?)`,
    ).get(s.eid) as
      | { status: string; project: string; title: string }
      | undefined
    assertEquals(task?.status, 'open')
    assertEquals(task?.project, p)
    assertEquals(task?.title.startsWith('consider:'), true)
    // The floor advanced past its start.
    let floor = (db.prepare(
      'select floor from dream where entity = (select id from entity where eid = ?)',
    ).get(d) as {
      floor: string
    }).floor
    assertEquals(floor > ago(30), true)
    // Re-armed: an untargeted cadence wake aimed back at the dream.
    let wake = db.prepare(
      `select 1 from wake w join deliver dv on dv.entity = w.entity
      where dv."to" = (select id from entity where eid = ?) and w.target is null`,
    ).get(d)
    assertEquals(!!wake, true)
    // The pass itself is graph data, written only after its outcomes read back.
    let pass = db.prepare(
      `select doc.body from notice n join doc_value doc on doc.entity = n.entity
       where n.target = (select id from entity where eid = ?)
         and n.event = 'sweep'`,
    ).get(d) as { body: string } | undefined
    assertEquals(pass?.body.includes('verified artifacts:'), true)
  },
)

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
    !!db.prepare(
      'select 1 from delivered where entity = (select id from entity where eid = ?)',
    ).get(k),
    false,
  )
})

slow(
  'dreamComb: a decision finding is captured as a memory, dated when taken',
  async () => {
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
       join doc_value doc on doc.entity = m.entity
       join decided dc on dc.entity = m.entity
      where doc.title = ?`,
    ).get('ADAPT complete() over batch') as { decided: string } | undefined
    assertEquals(!!mem, true)
    assertEquals(mem!.decided.startsWith('2026-08-10'), true)
  },
)

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

slow(
  'dreamComb: dedup — a recurring finding hit-counts, never re-files',
  async () => {
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
       join dependency dep on dep.parent = fd.entity
      where dep.type = 'about' and dep.child = (select id from entity where eid = ?)`,
    ).all(s.eid) as { hits: number }[]
    assertEquals(hits.length, 1)
    assertEquals(hits[0].hits, 2)
  },
)

slow(
  'dreamComb: skip — a finding naming a resolved task is not filed',
  async () => {
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
      where dep.type = 'about' and dep.child = (select id from entity where eid = ?)
        and exists (select 1 from task t where t.entity = dep.parent)`,
    ).get(s.eid) as { n: number }
    assertEquals(n.n, 0)
  },
)

slow(
  'dreamComb: a reflex finding becomes a venture memory, not a consider task',
  async () => {
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
      `select (select eid from entity where id = m.scope) as scope
       from memory m join doc_value doc on doc.entity = m.entity
      where doc.title = ?`,
    ).get(title) as { scope: string } | undefined
    assertEquals(!!mem, true)
    assertEquals(mem!.scope, p)
    let considers = db.prepare(
      'select count(*) as n from doc_value where title = ?',
    )
      .get(`consider: ${title}`) as { n: number }
    assertEquals(considers.n, 0)
  },
)

slow(
  'dreamComb: two sessions, one shared finding — filed once (batch + within-run dedup)',
  async () => {
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
    let considers = db.prepare(
      'select count(*) as n from doc_value where title = ?',
    )
      .get('consider: unify the widget path') as { n: number }
    assertEquals(considers.n, 1)
  },
)

slow(
  'nearestMemory: the nearest MEMORY above the dupe floor, never a plain task',
  () => {
    let m = memWithVec('a documented principle', vec(-1, 0))
    let t = docWithVec('a task in the same words', vec(-1, 0)) // near, not a memory
    // The query direction returns the MEMORY, skipping the equally-near task.
    assertEquals(nearestMemory(vec(-1, 0)), m)
    assertEquals(nearestMemory(vec(-1, 0)) == t, false)
    // A query far from every memory returns nothing — no reinforcement to make.
    assertEquals(nearestMemory(vec(-1, -1)), undefined)
  },
)

slow(
  'dreamComb: a finding restating a memory in new words reinforces it, files nothing',
  async () => {
    let p = proj('Reinforce venture')
    let d = dreamEnt(p, ago(30))
    let s = sess(p, ago(2))
    msg(s.eid, 'leaned on a principle the fleet already wrote down')
    let m = memWithVec('escalate only the irreversible', vec(0, -1))
    // The WORDS differ (key-dedup slides past), but embedFn maps the finding onto
    // the memory's vector — a semantic twin the title-key can never catch.
    let title =
      'decide reversible calls yourself, escalate what cannot be undone'
    let reply = says(JSON.stringify({
      kind: 'reflex',
      title,
      body: 'a reversible call parked costs more than a wrong one corrected',
      priority: 2,
    }))
    let near = () => Promise.resolve(vec(0, -1))
    await dreamComb(noop, reply as never, near as never)(knock(d))
    // Nothing new filed under the finding's title — no twin memory, no task.
    let filed = db.prepare(
      'select count(*) as n from doc_value where title = ?',
    )
      .get(title) as { n: number }
    assertEquals(filed.n, 0)
    // The matched memory was reinforced: recall bumped, last_confirmed_at stamped.
    let rc = db.prepare(
      'select count from recall where entity = (select id from entity where eid = ?)',
    ).get(m) as
      | { count: number }
      | undefined
    assertEquals(rc?.count, 1)
    let mm = db.prepare(
      'select last_confirmed_at as c from memory where entity = (select id from entity where eid = ?)',
    )
      .get(m) as { c: string | null }
    assertEquals(!!mm.c, true)
  },
)

slow(
  'dreamComb: a genuinely novel finding still files despite the semantic gate',
  async () => {
    let p = proj('Novel venture')
    let d = dreamEnt(p, ago(30))
    let s = sess(p, ago(2))
    msg(s.eid, 'hit a wall nobody had written down')
    memWithVec('an unrelated documented lesson', vec(-1, 0))
    let reply = says(JSON.stringify({
      kind: 'gap',
      title: 'add a widget-purge verb',
      body: 'no warm path to purge widgets',
      priority: 3,
    }))
    let far = () => Promise.resolve(vec(-1, -1)) // near no memory
    await dreamComb(noop, reply as never, far as never)(knock(d))
    // The gate let it through: a consider task filed, exactly one.
    let considers = db.prepare(
      'select count(*) as n from doc_value where title = ?',
    )
      .get('consider: add a widget-purge verb') as { n: number }
    assertEquals(considers.n, 1)
  },
)

// ——— T-18730: the dream as a system role — seeding sweep, pause as role data ———

Deno.test('dreamRun seeds every unwoken dream, then reports all armed', () => {
  let p = proj('Sweep venture')
  let d = dreamEnt(p, ago(30))
  let out = dreamRun({ quiet: 1, cooldown: 60 }, noop)
  assertEquals(out.reason.startsWith('seeded '), true)
  assertEquals(unwoken().includes(d), false) // now armed
  // nothing left unwoken — the next pass says so
  assertEquals(dreamRun({ quiet: 1, cooldown: 60 }, noop), {
    reason: 'every dream is armed',
  })
})

Deno.test('a stopped dream role consumes a knock without combing or re-arming', async () => {
  let role = uid()
  apply(db, [
    { eid: role, name: 'doc', comp: { title: 'dream', body: '' } },
    { eid: role, name: 'alias', comp: { slug: 'dream' } },
    {
      eid: role,
      name: 'role',
      comp: { state: 'stopped', surface: 'native' },
    },
  ])
  try {
    let p = proj('Paused venture')
    let f0 = ago(30)
    let d = dreamEnt(p, f0)
    let s = sess(p, ago(2))
    msg(s.eid, 'work that would have been combed')
    let k = knock(d)
    let combed = false
    let fake = () => {
      combed = true
      return Promise.resolve(null)
    }
    await dreamComb(noop, fake as never)(k)
    // The knock is consumed — delivered, via the off stamp — but no model ran,
    // the floor did not move, and no cadence wake re-armed.
    let via = db.prepare(
      `select via from delivered
        where entity = (select id from entity where eid = ?)`,
    ).get(k) as { via: string } | undefined
    assertEquals(via?.via, 'dream off')
    assertEquals(combed, false)
    let floor = (db.prepare(
      `select floor from dream
        where entity = (select id from entity where eid = ?)`,
    ).get(d) as { floor: string }).floor
    assertEquals(floor, f0)
    let wake = db.prepare(
      `select 1 from wake w join deliver dv on dv.entity = w.entity
        where dv."to" = (select id from entity where eid = ?)`,
    ).get(d)
    assertEquals(!!wake, false)
  } finally {
    apply(db, [{ eid: role, name: 'entity', comp: null }])
  }
})
