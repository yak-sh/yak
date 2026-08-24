// The tasks channel's pure seam — the filter (which broadcast changes are aimed
// at a session) and the format (how each renders as a channel event), proven
// without a socket or an MCP pipe. Run: deno test -A channels/tasks/.
import { assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import type { Change } from '../../src/types.ts'
import {
  channelAck,
  channelBaseline,
  channelEvents,
  cleanAttr,
  cleanBody,
  type Ctx,
  docOf,
  doneOf,
  findSession,
  humanId,
  type Index,
  learn,
  notifiedOf,
  printRun,
} from '../../src/channel.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, delta, snapshot } = await import('../../src/db.ts')
let { freshDb } = await import('../../src/testdb.ts')

let ch = (
  eid: string,
  name: string,
  comp: Record<string, unknown> | null,
): Change => ({ eid, name, comp })

// A knock is a knock comp + the shared deliver.to (D-14945): WHO it is for no
// longer rides the knock comp, so the batch carries a deliver change beside it.
let knock = (eid: string, to: string, target?: string): Change[] => [
  ch(eid, 'knock', target ? { target: target } : {}),
  ch(eid, 'deliver', { to }),
]

// A stub id book — the socket-fed index is exercised separately (learn tests).
let idOf = (eid: string): string | null =>
  ({
    sess: 'S-31',
    s1: 'S-1',
    t9: 'T-9',
    p1: 'P-1',
    m1: 'E-5',
  } as Record<
    string,
    string
  >)[eid] ?? null

let comment = (
  eid: string,
  target: string,
  by = 'p1',
  via = 's1',
): Change[] => [
  ch(eid, 'comment', { target }),
  ch(eid, 'created', { by, via }),
]

let ctx = (over: Partial<Ctx> = {}): Ctx => ({
  sessionEid: 'sess',
  actorEid: 'actor',
  homeEid: 'home',
  operator: true,
  idOf,
  ...over,
})

// --- comments ----------------------------------------------------------------

Deno.test('a deprecated direct-session comment still emits', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'ping' }),
    ...comment('c1', 'sess'),
  ]
  let expected = [{
    content: 'ping',
    meta: { kind: 'comment', from: 'P-1 · via S-1' },
    eid: 'c1',
  }]
  for (let mode of [undefined, 'catchup', 'resume'] as const) {
    assertEquals(channelEvents(batch, ctx({ mode })), expected)
  }
})

Deno.test('a comment mint with no doc in the batch is skipped (bodiless)', () => {
  let batch = comment('c1', 'sess')
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('a comment aimed elsewhere is ignored', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'ping' }),
    ...comment('c1', 'other'),
  ]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('a meta-tagged comment on the session is NOT delivered live (T-17319)', () => {
  // The load-bearing half: a :meta memo that falls back to anchoring on the
  // session entity would otherwise deliver as an ordinary comment aimed at
  // that session. The `meta` tag rides the same batch and suppresses it, so
  // the doer is never knocked — the dream harvests it later instead.
  let batch = [
    ch('c1', 'doc', { title: '', body: 'a note for the dream' }),
    ...comment('c1', 'sess'),
    ch('c1', 'meta', {}),
  ]
  for (let mode of [undefined, 'catchup', 'resume', 'inbox'] as const) {
    assertEquals(channelEvents(batch, ctx({ mode })), [])
  }
})

Deno.test('a comment on a CLAIMED task is delivered, naming the task', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'take a look' }),
    ...comment('c1', 't9'),
  ]
  assertEquals(channelEvents(batch, ctx({ claimedEids: new Set(['t9']) })), [
    {
      content: 'take a look',
      meta: { kind: 'comment', from: 'P-1 · via S-1', on: 'T-9' },
      eid: 'c1',
    },
  ])
})

Deno.test('a comment on an UNCLAIMED task is dropped', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'not for you' }),
    ...comment('c1', 't9'),
  ]
  // The session holds a different task, so t9 is foreign.
  assertEquals(
    channelEvents(batch, ctx({ claimedEids: new Set(['other']) })),
    [],
  )
})

Deno.test('unresolvable provenance renders as unknown', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'hey' }),
    ...comment('c1', 'sess', 'zzz', 'xxx'),
  ]
  assertEquals(channelEvents(batch, ctx())[0].meta.from, 'unknown')
})

Deno.test('a comment falls back to its title when the body is empty', () => {
  let batch = [
    ch('c1', 'doc', { title: 'subject only', body: '' }),
    ...comment('c1', 'sess'),
  ]
  assertEquals(channelEvents(batch, ctx())[0].content, 'subject only')
})

// --- knocks ------------------------------------------------------------------

Deno.test('a knock at the session names its target as a human id', () => {
  let batch = knock('k1', 'sess', 't9')
  assertEquals(channelEvents(batch, ctx()), [
    { content: 'look at T-9', meta: { kind: 'knock' }, eid: 'k1' },
  ])
})

Deno.test('an operator receives a knock at the session actor', () => {
  let batch = knock('k1', 'actor', 't9')
  assertEquals(channelEvents(batch, ctx())[0].content, 'look at T-9')
})

Deno.test('a non-operator receives session knocks, not actor knocks', () => {
  let direct = knock('k1', 'sess', 't9')
  let project = knock('k2', 'actor', 't9')
  assertEquals(
    channelEvents([...direct, ...project], ctx({ operator: false })),
    [
      { content: 'look at T-9', meta: { kind: 'knock' }, eid: 'k1' },
    ],
  )
})

Deno.test('a knock naming only its recipient has no look-at target', () => {
  let batch = knock('k1', 'sess')
  assertEquals(channelEvents(batch, ctx()), [
    { content: 'a knock', meta: { kind: 'knock' }, eid: 'k1' },
  ])
})

// A cadence wake fires a knock delivered to the operator's OWN home board,
// pointed at that board — its own timer coming back. It reads as a return, not
// as a stranger pointing you somewhere (T-17654). The operator hears it because
// its actor IS its home board.
let mine = ctx({ actorEid: 'p1', homeEid: 'p1', idOf })

Deno.test('a cadence return names your own board, not "look at X"', () => {
  let batch = knock('k1', 'p1', 'p1')
  assertEquals(channelEvents(batch, mine), [
    { content: 'your pass resumes on P-1', meta: { kind: 'knock' }, eid: 'k1' },
  ])
})

Deno.test('a cadence return carries the note that rode its wake', () => {
  let batch = [
    ...knock('k1', 'p1', 'p1'),
    ch('c1', 'doc', { title: '', body: 'mid mail-loop port, T-7018 next' }),
    ...comment('c1', 'p1'),
  ]
  assertEquals(
    channelEvents(batch, mine)[0].content,
    'your pass resumes on P-1 — mid mail-loop port, T-7018 next',
  )
})

Deno.test('a knock at another target is a nudge even for an operator at home', () => {
  // Same operator (actor == home), but pointed elsewhere — a real ask, not a
  // return, so it reads "look at X".
  let batch = knock('k1', 'p1', 't9')
  assertEquals(channelEvents(batch, mine)[0].content, 'look at T-9')
})

Deno.test('a knock carries the words of the comment on its TARGET', () => {
  let batch = [
    ...knock('k1', 'sess', 't9'),
    ch('c1', 'doc', { title: '', body: 'take a look' }),
    ...comment('c1', 't9'),
  ]
  let out = channelEvents(batch, ctx())
  assertEquals(out, [{
    content: 'look at T-9 — take a look',
    meta: { kind: 'knock' },
    eid: 'k1',
  }])
})

Deno.test('a knock aimed at neither the session nor its actor is ignored', () => {
  let batch = knock('k1', 'stranger', 't9')
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test("the resolver's settle broadcast is a receipt, not a nudge", () => {
  // The outcome is its own frame (D-14945): a knock that already settled
  // delivered is a receipt, so a live batch carrying both stays silent.
  let batch = [
    ...knock('k1', 'sess', 't9'),
    ch('k1', 'delivered', { at: '2026-07-27T00:00:00Z', via: 'cast S-1' }),
  ]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('an inbox sweep deliberately reads an addressed settled knock', () => {
  let batch = [
    ...knock('k1', 'sess', 't9'),
    ch('k1', 'error', {
      at: '2026-07-27T00:00:00Z',
      message: 'no live channel',
    }),
  ]
  assertEquals(channelEvents(batch, ctx({ mode: 'inbox' })), [
    { content: 'look at T-9', meta: { kind: 'knock' }, eid: 'k1' },
  ])
})

// --- mail --------------------------------------------------------------------
// The arrival signal is the sweep's full-row stamp broadcast: a bare `mail`
// change carrying received_at (server-only, never on a wire patch). The doc
// rides an EARLIER frame (a mint) or the boot snapshot (an echo), so the words
// come from ctx.docOf.

let stamp = (over: Record<string, unknown> = {}) =>
  ch('m1', 'mail', {
    to_addr: 'taskmaster@bot.test',
    from: 'jeff@yak.sh',
    target: 'home',
    message_id: 'msg:1:x',
    received_at: '2026-07-22T00:00:00Z',
    verified: 1,
    ...over,
  })

let letter = () => ({ title: 'hello', body: 'a letter' })

Deno.test('a verified unread mail for the home project injects', () => {
  let out = channelEvents([stamp()], ctx({ docOf: () => letter() }))
  assertEquals(out, [{
    content: 'a letter',
    meta: {
      kind: 'mail',
      from: 'jeff@yak.sh',
      auth: 'VERIFIED',
      subj: 'hello',
      id: 'E-5',
    },
    eid: 'm1',
  }])
})

Deno.test('unverified mail never injects — it waits for triage', () => {
  let out = channelEvents([stamp({ verified: 0 })], ctx({ docOf: letter }))
  assertEquals(out, [])
})

// A letter addressed to the SESSION by id (`S-31@bot.test`) is direct
// address, so it rings whatever loop this is — the operator gate belongs to
// project mail alone. Without this the address resolves perfectly and the
// session it names never hears about it.
Deno.test('mail addressed to this session injects without operator', () => {
  let mine = stamp({ to: 'S-31@bot.test', target: 'sess' })
  let out = channelEvents([mine], ctx({ docOf: letter, operator: false }))
  assertEquals(out.length, 1)
  assertEquals(out[0].meta.kind, 'mail')
  // The project arm is untouched: a specialist still hears no venture mail.
  assertEquals(
    channelEvents([stamp()], ctx({ docOf: letter, operator: false })),
    [],
  )
})

Deno.test('mail already opened/archived is not re-announced', () => {
  let batch = [stamp()]
  let dealt = ctx({ docOf: letter, done: () => true })
  assertEquals(channelEvents(batch, dealt), [])
})

Deno.test('a specialist session gets no project mail (T-7006)', () => {
  // operator == false marks a managed spawn / task-started session — project
  // mail is gated, though direct address still reaches it (comment tests).
  assertEquals(
    channelEvents([stamp()], ctx({ docOf: letter, operator: false })),
    [],
  )
  // the operator loop (default) still hears it
  assertEquals(
    channelEvents([stamp()], ctx({ docOf: letter, operator: true })).length,
    1,
  )
})

Deno.test("mail aimed at another project isn't this session's", () => {
  let batch = [stamp({ target: 'elsewhere' })]
  assertEquals(channelEvents(batch, ctx({ docOf: letter })), [])
})

Deno.test('no resolved home project, no mail delivery', () => {
  let batch = [stamp()]
  assertEquals(channelEvents(batch, ctx({ homeEid: null, docOf: letter })), [])
})

Deno.test("a mint's wire frame (no received_at) is not the arrival", () => {
  let batch = [
    ch('m1', 'doc', { title: 'hello', body: 'a letter' }),
    ch('m1', 'mail', { from: 'jeff@yak.sh', target: 'home' }),
  ]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('an echo arrival with no doc anywhere falls back to a pointer', () => {
  let out = channelEvents([stamp()], ctx())
  assertEquals(out[0].content, 'mail E-5 from jeff@yak.sh — task mail show E-5')
  assertEquals(out[0].eid, 'm1')
  assertEquals(out[0].meta, {
    kind: 'mail',
    from: 'jeff@yak.sh',
    auth: 'VERIFIED',
    id: 'E-5',
  })
})

Deno.test('an already-notified item is not re-injected (durable dedup)', () => {
  // The plugin stamps `notified` after each inject and reads it back through
  // ctx.notified — so a re-broadcast (or a reconnect that re-syncs the same
  // arrival) never rings twice. Comments and knocks dedup the same way.
  let told = new Set<string>()
  let c = ctx({ docOf: letter, notified: (e) => told.has(e) })
  let first = channelEvents([stamp()], c)
  assertEquals(first.length, 1)
  told.add(first[0].eid) // the plugin's post-inject stamp
  assertEquals(channelEvents([stamp()], c), [])
})

Deno.test('a bus-notified item injects; a channel-notified item does not', () => {
  // The shared presence cannot answer whether PUSH happened. The baseline is
  // the durable subset whose anonymous provenance proves a prior channel did.
  let c = (over: Partial<Ctx>) =>
    ctx({ docOf: letter, notified: () => true, ...over })
  // No baseline (tests, the inbox sweep): the whole-`notified` gate stands.
  assertEquals(
    channelEvents([stamp()], c({})).length,
    0,
    'no baseline: old gate',
  )
  // A session-authored bus stamp is outside the PUSH baseline, so it rings.
  assertEquals(
    channelEvents([stamp()], c({ baseline: () => false })).length,
    1,
    'bus-only: the push fires',
  )
  // An anonymous channel stamp belongs to the baseline and stays silent.
  assertEquals(
    channelEvents([stamp()], c({ baseline: () => true })).length,
    0,
    'channel-confirmed history stays silent',
  )
  // Our own delivery still outranks the baseline lift.
  assertEquals(
    channelEvents([stamp()], c({ baseline: () => false, sent: () => true }))
      .length,
    0,
    'what this run already sent is never re-rung',
  )
})

slow('a fresh channel recovers a bus stamp once, then stays quiet', () => {
  let db = freshDb()
  let item = crypto.randomUUID()
  let bus = crypto.randomUUID()
  apply(db, [
    { eid: item, name: 'doc', comp: { title: 'hello', body: 'a letter' } },
    { eid: bus, name: 'session', comp: { id: 'bus-session' } },
  ])
  apply(
    db,
    [{ eid: item, name: 'notified', comp: {} }],
    undefined,
    'bus-session',
  )

  let boot = () => {
    let changes = [...snapshot(db).changes, { ...stamp(), eid: item }]
    let index: Index = new Map()
    learn(index, changes)
    let baseline = channelBaseline(changes)
    return channelEvents(changes, {
      ...ctx({
        docOf: letter,
        idOf: (eid) => eid == item ? 'E-5' : idOf(eid),
        mode: 'resume',
      }),
      done: (eid) => doneOf(index, eid),
      notified: (eid) => notifiedOf(index, eid),
      baseline: (eid) => baseline.has(eid),
    })
  }

  let busStamp = snapshot(db).changes.find((c) =>
    c.eid == item && c.name == 'notified'
  )
  assertEquals(busStamp?.comp?.via, bus)
  assertEquals(boot().map((e) => e.eid), [item])

  // The successful push promotes the shared stamp to a durable channel proof.
  apply(db, channelAck(item, true))
  let channelStamp = snapshot(db).changes.find((c) =>
    c.eid == item && c.name == 'notified'
  )
  assertEquals(channelStamp?.comp?.via, null)
  assertEquals(boot(), [])
  assertEquals(boot(), [])

  // Read-state remains the stronger gate even when only the bus told it.
  apply(db, [{ eid: item, name: 'notified', comp: null }])
  apply(
    db,
    [{ eid: item, name: 'notified', comp: {} }],
    undefined,
    'bus-session',
  )
  apply(db, [{ eid: item, name: 'opened', comp: {} }])
  assertEquals(boot(), [])
})

Deno.test('a catch-up replay pushes a notified gap item anyway (T-7167)', () => {
  // The idle-operator case: the digest/bus stamped `notified` while the channel
  // was down, so the live gate would skip it — but the {since} catch-up replay
  // is exactly the push that idle operator never got, so it must fire. Holds for
  // mail, comments, and knocks.
  let told = () => true // everything already notified by the sweep
  assertEquals(
    channelEvents([stamp()], ctx({ docOf: letter, notified: told })).length,
    0,
    'live frame: notified suppresses',
  )
  assertEquals(
    channelEvents(
      [stamp()],
      ctx({ docOf: letter, notified: told, mode: 'catchup' }),
    )
      .length,
    1,
    'catch-up: notified lifts',
  )
  let cmt: Change[] = [
    ...comment('c9', 'sess'),
    ch('c9', 'doc', { title: '', body: 'gap message' }),
  ]
  assertEquals(channelEvents(cmt, ctx({ notified: told })), [])
  assertEquals(
    channelEvents(cmt, ctx({ notified: told, mode: 'catchup' }))[0].content,
    'gap message',
  )
})

slow('a catch-up comment keeps its actor and instrument byline', () => {
  let db = freshDb()
  let actor = crypto.randomUUID()
  let writer = crypto.randomUUID()
  let target = crypto.randomUUID()
  let writerId = crypto.randomUUID()
  apply(db, [
    { eid: actor, name: 'doc', comp: { title: 'Operator' } },
    { eid: actor, name: 'project', comp: {} },
    {
      eid: writer,
      name: 'session',
      comp: { id: writerId, actor: actor },
    },
    { eid: target, name: 'session', comp: { id: crypto.randomUUID() } },
  ])
  let base = snapshot(db)
  let eid = crypto.randomUUID()
  apply(
    db,
    [
      { eid, name: 'doc', comp: { title: '', body: 'inside the gap' } },
      { eid, name: 'comment', comp: { target: target } },
    ],
    undefined,
    writerId,
  )

  let replay = delta(db, base.cursor ?? 0).changes
  let index: Index = new Map()
  learn(index, base.changes)
  learn(index, replay)
  let human = (eid: string) => humanId(index, eid)
  assertEquals(
    channelEvents(replay, {
      sessionEid: target,
      idOf: human,
      mode: 'catchup',
    }),
    [{
      content: 'inside the gap',
      meta: {
        kind: 'comment',
        from: `${human(actor)} · via ${human(writer)}`,
      },
      eid,
    }],
  )
})

Deno.test('what THIS run injected is never re-rung, even by a catch-up', () => {
  // Our own delivery memory outranks every mode: the `notified` write can be
  // lost (the server is down exactly when gaps happen), so the plugin keeps
  // its own record of what it said.
  let mine = new Set(['m1'])
  assertEquals(
    channelEvents(
      [stamp()],
      ctx({ docOf: letter, sent: (e) => mine.has(e), mode: 'catchup' }),
    ),
    [],
  )
})

// --- recall (T-17306) --------------------------------------------------------
// A recall entry (recall.ts) lands in a session's OWN log — the delivery address
// is its `entry.session` partition, no recipient facet. The `recalled` component
// is the marker; the floater lines ride the `content` body.

let recalled = (
  eid: string,
  session: string,
  body: string,
  source = 'msg',
): Change[] => [
  ch(eid, 'entry', { session }),
  ch(eid, 'content', { body }),
  ch(eid, 'recalled', { source }),
]

Deno.test('a recall entry in this session emits kind=recall with its floaters', () => {
  let batch = recalled('r1', 'sess', 'M-17299 · escalation is a bug report')
  assertEquals(channelEvents(batch, ctx()), [{
    content: 'M-17299 · escalation is a bug report',
    meta: { kind: 'recall' },
    eid: 'r1',
  }])
})

Deno.test("a recall entry in another session's log isn't this session's", () => {
  let batch = recalled('r1', 'elsewhere', 'M-1 · not for us')
  assertEquals(channelEvents(batch, ctx()), [])
})

// The realistic apply() return: every entry write echoes a SECOND `entry`
// change carrying only the server-stamped ingest coordinate `{eid, seq}`, no
// session (db.ts). A session-blind last-wins over entry changes would let that
// stamp erase the partition and drop the floater — the live-delivery bug behind
// "recall written but not injected" (T-17470). Delivery must survive the stamp.
Deno.test('a recall entry survives apply()s seq-stamp echo (live-inject shape)', () => {
  let batch = [
    ...recalled('r1', 'sess', 'M-9 · a floated thought'),
    ch('r1', 'entry', { eid: 'r1', seq: 2 }), // the stamped re-read, no session
  ]
  assertEquals(channelEvents(batch, ctx()), [{
    content: 'M-9 · a floated thought',
    meta: { kind: 'recall' },
    eid: 'r1',
  }])
})

Deno.test('a bodiless recall entry is skipped', () => {
  let batch = [
    ch('r1', 'entry', { session: 'sess' }),
    ch('r1', 'recalled', {
      source: 'msg',
    }),
  ]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('an already-notified recall entry is not re-injected', () => {
  let batch = recalled('r1', 'sess', 'M-5 · a floated thought')
  let told = new Set<string>()
  let c = ctx({ notified: (e) => told.has(e) })
  let first = channelEvents(batch, c)
  assertEquals(first.length, 1)
  told.add(first[0].eid) // the plugin's post-inject stamp
  assertEquals(channelEvents(batch, c), [])
})

// --- the reconnect sweep (T-7302) --------------------------------------------
// A knock that commits while the socket is down is INSIDE the snapshot the
// reconnect fetches, so no {since} window replays it. The resume pass reads
// state instead: the ladder stamped `cast S-31` — this session — and nothing
// ever stamped `notified`, so the stamp is a claim nobody made good.

// A settled knock is TWO frames now (D-14945): the knock and its delivered
// outcome. `via` names the ladder's claim — `cast S-31`, this session — and
// `at` is the receipt time the words window keys off.
let cast = (over: { via?: string; at?: string } = {}): Change[] => [
  ...knock('k7', 'sess', 't9'),
  ch('k7', 'delivered', {
    at: over.at ?? '2026-07-25T00:17:58Z',
    via: over.via ?? 'cast S-31',
  }),
]

Deno.test('a resume sweep rings the knock the disconnect ate (T-7302)', () => {
  assertEquals(channelEvents(cast(), ctx({ mode: 'resume' })), [
    { content: 'look at T-9', meta: { kind: 'knock' }, eid: 'k7' },
  ])
})

Deno.test('a resume sweep carries the words that rode THAT knock', () => {
  // A snapshot holds every comment ever aimed at the target, so the words are
  // picked by time — the knock's own minute — not by scan order.
  let born = (eid: string, at: string) => ch(eid, 'created', { eid, at })
  let batch: Change[] = [
    ch('old', 'comment', { target: 't9' }),
    ch('old', 'doc', { title: '', body: 'last tuesday' }),
    born('old', '2026-07-20T00:00:00Z'),
    ...cast(),
    born('k7', '2026-07-25T00:17:58Z'),
    ch('new', 'comment', { target: 't9' }),
    ch('new', 'doc', { title: '', body: 'the wake words' }),
    born('new', '2026-07-25T00:17:57.900Z'),
  ]
  assertEquals(
    channelEvents(batch, ctx({ mode: 'resume' }))[0].content,
    'look at T-9 — the wake words',
  )
  // Nothing in the window (a wake mints no comment at all) → bare nudge.
  assertEquals(
    channelEvents(
      [...cast(), born('k7', '2026-07-25T00:17:58Z')],
      ctx({
        mode: 'resume',
      }),
    )[0].content,
    'look at T-9',
  )
})

Deno.test('a resume sweep leaves a delivered knock alone', () => {
  // `notified` is the bound: the stamp was made good, so the row is history.
  assertEquals(
    channelEvents(cast(), ctx({ mode: 'resume', notified: () => true })),
    [],
  )
  // …and so is a knock the ladder resolved some OTHER way (spawn, mail) or
  // cast to a different session on this actor.
  assertEquals(
    channelEvents(
      cast({ via: 'spawned S-99' }),
      ctx({
        mode: 'resume',
      }),
    ),
    [],
  )
  assertEquals(
    channelEvents(cast({ via: 'cast S-99' }), ctx({ mode: 'resume' })),
    [],
  )
})

Deno.test('a live re-broadcast of that same stamp is still a receipt', () => {
  // Only the resume sweep reads a `cast S-me` stamp as a missed delivery;
  // live, the resolver's own re-broadcast must stay silent.
  assertEquals(channelEvents(cast(), ctx()), [])
  assertEquals(channelEvents(cast(), ctx({ mode: 'catchup' })), [])
})

Deno.test("learn caches a mail's doc for the stamp frame that follows", () => {
  let idx: Index = new Map()
  learn(idx, [
    ch('m1', 'entity', { num: 5 }),
    // doc BEFORE mail in the same batch — the second pass still catches it.
    ch('m1', 'doc', { title: 'hello', body: 'a letter' }),
    ch('m1', 'mail', { from: 'jeff@yak.sh', target: 'home' }),
  ])
  assertEquals(docOf(idx, 'm1'), { title: 'hello', body: 'a letter' })
  let out = channelEvents([stamp()], ctx({ docOf: (e) => docOf(idx, e) }))
  assertEquals(out[0].content, 'a letter')
})

Deno.test('a doc patch on a cached mail merges only what it carries', () => {
  let idx: Index = new Map()
  learn(idx, [
    ch('m1', 'doc', { title: 'hello', body: 'a letter' }),
    ch('m1', 'mail', {}),
  ])
  learn(idx, [ch('m1', 'doc', { body: 'edited' })])
  assertEquals(docOf(idx, 'm1'), { title: 'hello', body: 'edited' })
  assertEquals(docOf(idx, 'ghost'), null)
})

// --- identity ----------------------------------------------------------------

Deno.test('learn + humanId derive a human id from spine and components', () => {
  let idx: Index = new Map()
  learn(idx, [
    ch('e1', 'entity', { num: 31 }),
    ch('e1', 'session', { id: 'x' }),
    ch('e2', 'entity', { num: 9 }),
    ch('e2', 'doc', {}),
    ch('e2', 'task', {}),
  ])
  assertEquals(humanId(idx, 'e1'), 'S-31') // session prefix
  assertEquals(humanId(idx, 'e2'), 'T-9') // doc+task = task
  assertEquals(humanId(idx, 'ghost'), null) // never seen
})

Deno.test('learn forgets a tombstoned entity', () => {
  let idx: Index = new Map()
  learn(idx, [ch('e1', 'entity', { num: 5 }), ch('e1', 'doc', {})])
  learn(idx, [ch('e1', 'entity', null)])
  assertEquals(humanId(idx, 'e1'), null)
})

Deno.test('learn drops a component when its patch clears it', () => {
  let idx: Index = new Map()
  learn(idx, [ch('e1', 'entity', { num: 7 }), ch('e1', 'task', {})])
  learn(idx, [ch('e1', 'task', null)])
  assertEquals(humanId(idx, 'e1'), 'E-7') // no components → kind 'entity', capitalized initial
})

// The seat: whom this process serves. Identity is derived from the INDEX,
// so each fact below is "learn these batches, then ask" — the same rule
// src/door.ts asks server-side (served.ts).
let sessions = (...batches: Change[][]) => {
  let idx: Index = new Map()
  for (let b of batches) learn(idx, b)
  return idx
}

Deno.test('findSession resolves by the claude pid', () => {
  let idx = sessions([
    ch('e9', 'entity', { num: 9 }),
    ch('e9', 'session', { id: 'other', pid: 111, actor: 'x' }),
    ch('e1', 'entity', { num: 1 }),
    ch('e1', 'session', {
      id: 'mine',
      pid: 4242,
      actor: 'p1',
      persona: 'n1',
    }),
  ])
  assertEquals(findSession(idx, { pid: 4242 }), {
    eid: 'e1',
    id: 'mine',
    pid: 4242,
    actorEid: 'p1',
    personaEid: 'n1',
  })
  assertEquals(findSession(idx, { pid: 999 }), undefined)
})

Deno.test('findSession: the NEWEST row on the pid wins — /clear rotates forward', () => {
  let idx = sessions(
    [
      ch('old', 'entity', { num: 10 }),
      ch('old', 'session', {
        id: 'before-clear',
        pid: 4242,
      }),
    ],
    [
      ch('new', 'entity', { num: 11 }),
      ch('new', 'session', {
        id: 'after-clear',
        pid: 4242,
      }),
    ],
  )
  assertEquals(findSession(idx, { pid: 4242 })?.eid, 'new')
})

Deno.test('a subagent reifying takes no seat — a child wears no pid (T-7288)', () => {
  // The subagent runs INSIDE the operator's claude and mints its own id, so
  // its row is NEWER than the operator's; only the missing pid keeps the
  // operator's channel from following it into a session nothing renders for.
  let idx = sessions(
    [
      ch('op', 'entity', { num: 10 }),
      ch('op', 'session', {
        id: 'operator',
        pid: 4242,
      }),
    ],
    [
      ch('kid', 'entity', { num: 11 }),
      ch('kid', 'session', {
        id: 'agent-T7279-aada990f',
      }),
    ],
  )
  assertEquals(findSession(idx, { pid: 4242 })?.eid, 'op')
})

Deno.test('clearing a ghost row rotates service BACK to the live session', () => {
  // The live-db case (T-7288): a child row reified before the fix wears the
  // operator's pid and outranks it. The old forward-only rule could never
  // leave it; a derived seat follows the repair on the next batch.
  let idx = sessions(
    [
      ch('op', 'entity', { num: 10 }),
      ch('op', 'session', {
        id: 'operator',
        pid: 4242,
      }),
    ],
    [
      ch('ghost', 'entity', { num: 11 }),
      ch('ghost', 'session', {
        id: 'ghost',
        pid: 4242,
      }),
    ],
  )
  assertEquals(findSession(idx, { pid: 4242 })?.eid, 'ghost')
  learn(idx, [ch('ghost', 'session', { pid: null })])
  assertEquals(findSession(idx, { pid: 4242 })?.eid, 'op')
})

Deno.test('a sid-less row on the pid does not shadow the conversation', () => {
  // The T-15147 channel half: an artifact row (hand-reified probe, a
  // malformed reify) wears the operator's pid with NO session id and a
  // newer num. A conversation always has a sid — reify keys on it — so
  // the seat is the newest sid-bearing row, and comments aimed at the
  // operator keep injecting.
  let idx = sessions(
    [
      ch('op', 'entity', { num: 10 }),
      ch('op', 'session', { id: 'operator', pid: 4242 }),
    ],
    [
      ch('bare', 'entity', { num: 11 }),
      ch('bare', 'session', { pid: 4242 }),
    ],
  )
  assertEquals(findSession(idx, { pid: 4242 })?.eid, 'op')
})

Deno.test('findSession: a pid match outranks the boot id hint', () => {
  let idx = sessions([
    ch('hinted', 'entity', { num: 1 }),
    ch('hinted', 'session', { id: 'boot-id' }),
    ch('mine', 'entity', { num: 2 }),
    ch('mine', 'session', { id: 'rotated-id', pid: 4242 }),
  ])
  assertEquals(findSession(idx, { pid: 4242, id: 'boot-id' })?.eid, 'mine')
})

Deno.test('findSession falls back to the boot id when no pid stamp exists', () => {
  let idx = sessions([
    ch('e1', 'entity', { num: 1 }),
    ch('e1', 'session', { id: 'boot-id', actor: 'p1' }),
  ])
  assertEquals(findSession(idx, { pid: 4242, id: 'boot-id' }), {
    eid: 'e1',
    id: 'boot-id',
    actorEid: 'p1',
  })
  assertEquals(findSession(idx, { id: 'missing' }), undefined)
})

Deno.test('a session patch merges — a later frame never blanks the actor', () => {
  let idx = sessions(
    [
      ch('e1', 'entity', { num: 1 }),
      ch('e1', 'session', {
        id: 'mine',
        pid: 4242,
        actor: 'p1',
      }),
    ],
    [ch('e1', 'session', { acked_at: 'now' })],
  )
  assertEquals(findSession(idx, { pid: 4242 })?.actorEid, 'p1')
})

Deno.test('findSession reads the operator/specialist marks off the reify', () => {
  let idx = sessions([
    ch('e1', 'entity', { num: 1 }),
    ch('e1', 'session', {
      id: 'sp',
      pid: 4242,
      operator: 1,
      origin: 'managed',
      requested_task: 't7',
    }),
  ])
  let s = findSession(idx, { pid: 4242 })
  assertEquals(s?.operator, true)
  assertEquals(s?.origin, 'managed')
  assertEquals(s?.requestedTaskEid, 't7')
})

Deno.test('a tombstoned session leaves no seat behind', () => {
  let idx = sessions(
    [
      ch('e1', 'entity', { num: 1 }),
      ch('e1', 'session', {
        id: 'mine',
        pid: 4242,
      }),
    ],
    [ch('e1', 'entity', null)],
  )
  assertEquals(findSession(idx, { pid: 4242 }), undefined)
})

// --- sanitization ------------------------------------------------------------

Deno.test('cleanAttr collapses newlines and drops tag-breaking chars', () => {
  assertEquals(cleanAttr('a\nb"<>c'), 'a bc')
})

Deno.test('cleanBody strips control bytes but keeps newlines and tabs', () => {
  assertEquals(cleanBody('line1\n\tline2\x00\x07'), 'line1\n\tline2')
})

// --- print mode ---------------------------------------------------------------

Deno.test('a print-mode claude is known by its flags, never its prompt', () => {
  assertEquals(printRun(['claude', '-p', '--model', 'x', '--', 'fix it']), true)
  assertEquals(printRun(['claude', '--print']), true)
  assertEquals(printRun(['claude', '--dangerously-skip-permissions']), false)
  // dash-leading words after `--` are the prompt, not flags
  assertEquals(printRun(['claude', '--', 'try -p or --print later']), false)
  assertEquals(printRun([]), false)
})
