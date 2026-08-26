// The doctor's pure seams: the book (who counts), the diagnosis (what
// fails), and the static snapshot's own hygiene. Degrade mode only —
// CI must never touch Cloudflare; liveRules is an operator's path,
// exercised by running `task mail doctor` with a routing-read token.
import {
  bookOf,
  brokenBoards,
  type Check,
  diagnose,
  integrityReport,
  mailCheck,
  mailWithoutFrom,
  type Rules,
  run,
  staleClaims,
  STATIC_RULES,
  stuckSessions,
  undispatched,
} from './doctor.ts'
import { canon } from './mailaddr.ts'
import type { Querier, Row } from './client.ts'
import { assertEquals } from '@std/assert'

Deno.env.set('TASKS_MAIL_DOMAIN', 'bot.test')

let row = (
  num: number,
  address: string,
  extra: Record<string, Record<string, unknown>> = {},
): Row => ({
  eid: `e-${num}`,
  num,
  kind: 'project',
  comps: {
    doc: { title: `p${num}` },
    project: {},
    email: { address },
    ...extra,
  },
})

let rules = (values: string[], catchall = false): Rules => ({
  live: false,
  catchall,
  rules: values.map((value) => ({ value, enabled: true })),
})

Deno.test('bookOf: email wearers in play; retired projects are history', () => {
  let all = [
    row(1, 'a@bot.test'),
    row(2, 'gone@bot.test', { archived: { at: '2026-07-21' } }),
    {
      eid: 'e-3',
      num: 3,
      kind: 'person',
      comps: { email: { address: 'kept@bot.test' }, archived: { at: 'now' } },
    },
  ]
  assertEquals(bookOf(all), [
    { address: 'a@bot.test', owner: 'P-1 p1' },
    { address: 'kept@bot.test', owner: 'U-3' },
  ])
})

Deno.test('diagnose: a ruled address is deliverable', () => {
  let book = [{ address: 'a@bot.test', owner: 'P-1' }]
  assertEquals(diagnose(book, rules(['a@bot.test'])), [])
})

Deno.test('diagnose: no rule + catch-all off = the silent drop', () => {
  let bad = diagnose([{ address: 'b@bot.test', owner: 'P-2' }], rules([]))
  assertEquals(bad.length, 1)
  assertEquals(bad[0].address, 'b@bot.test')
})

Deno.test('diagnose: the catch-all covers what no rule names', () => {
  let book = [{ address: 'b@bot.test', owner: 'P-2' }]
  assertEquals(diagnose(book, rules([], true)), [])
})

Deno.test('diagnose: a disabled rule is no rule', () => {
  let r: Rules = {
    live: false,
    catchall: false,
    rules: [{ value: 'c@bot.test', enabled: false }],
  }
  assertEquals(
    diagnose([{ address: 'c@bot.test', owner: 'P-3' }], r).length,
    1,
  )
})

Deno.test('diagnose: rule match is case-insensitive', () => {
  let book = [{ address: 'd@bot.test', owner: 'P-4' }]
  assertEquals(diagnose(book, rules(['D@BOT.TEST'])), [])
})

Deno.test('diagnose: an underscore local-part fails even with a rule', () => {
  let book = [{ address: 'cafe_car@bot.test', owner: 'P-5' }]
  let bad = diagnose(book, rules(['cafe_car@bot.test'], true))
  assertEquals(bad.length, 1)
  assertEquals(bad[0].problem.includes('cafecar@bot.test'), true)
})

Deno.test('diagnose: external mailboxes are not ours to judge', () => {
  assertEquals(
    diagnose([{ address: 'jeff@yak.sh', owner: 'U-1' }], rules([])),
    [],
  )
})

Deno.test('static snapshot: marked non-live, every value canonical', () => {
  assertEquals(STATIC_RULES.live, false)
  for (let r of STATIC_RULES.rules) assertEquals(canon(r.value), r.value)
})

// The measurement/guess split (T-10610). A rule verdict is only as true as
// the rules we read; a local-part verdict is decided by canon alone.
Deno.test('diagnose: fromRules marks which verdicts depend on the rule set', () => {
  let ruleGap = diagnose([{ address: 'b@bot.test', owner: 'P-2' }], rules([]))
  assertEquals(ruleGap[0].fromRules, true)
  // An underscore is illegal whatever the rules say — authoritative either way.
  let illegal = diagnose(
    [{ address: 'a_b@bot.test', owner: 'P-3' }],
    rules(['a_b@bot.test']),
  )
  assertEquals(illegal[0].fromRules, false)
})

Deno.test('diagnose: the snapshot says UNVERIFIED where live says drops', () => {
  let book = [{ address: 'b@bot.test', owner: 'P-2' }]
  let snap = diagnose(book, { live: false, catchall: false, rules: [] })
  let live = diagnose(book, { live: true, catchall: false, rules: [] })
  // Same finding, different claim — the snapshot must not assert a drop.
  assertEquals(snap[0].problem.includes('UNVERIFIED'), true)
  assertEquals(snap[0].problem.includes('drops silently'), false)
  assertEquals(live[0].problem.includes('drops silently'), true)
})

// The regression guard for the drift that started this: the doctor once
// called the fleet's OWN address undeliverable while mail was arriving at
// it (T-10480). Guard the VERDICT, not what carries it — routing is one
// catch-all now, and pinning literal rules would only re-pin the mechanism
// that drifted. Any canonical fleet address must come back clean.
Deno.test("static snapshot: the fleet's own addresses read deliverable", () => {
  for (let a of ['task@bot.test', 'taskmaster@bot.test']) {
    assertEquals(diagnose([{ address: a, owner: 'P-19' }], STATIC_RULES), [])
  }
})

// The catch-all is what makes that true, so say so out loud: drop it and
// every fleet-domain address goes back to reporting a silent drop.
Deno.test('static snapshot: without the catch-all, the same address is a finding', () => {
  let book = [{ address: 'task@bot.test', owner: 'P-19' }]
  let off = diagnose(book, { ...STATIC_RULES, catchall: false })
  assertEquals(off.length, 1)
  assertEquals(off[0].fromRules, true)
})

// ---- The rest of the registry: each check's pure verdict, and the runner.

let ent = (kind: string, num: number, comps: Row['comps']): Row => ({
  eid: `e-${num}`,
  num,
  kind,
  comps,
})

Deno.test('mail-from: an arrived letter with no sender is a hard finding', () => {
  let rows = [
    ent('mail', 1, { mail: { message_id: '<a>', from: 'x@y' } }),
    ent('mail', 2, { mail: { message_id: '<b>' } }), // arrived, no from
    ent('mail', 3, { mail: {} }), // outbound draft, never arrived
  ]
  let bad = mailWithoutFrom(rows)
  assertEquals(bad.length, 1)
  assertEquals(bad[0].level, 'fail')
  assertEquals(bad[0].text.startsWith('E-2 '), true)
})

Deno.test('board: a query that no longer parses is a hard finding', () => {
  let rows = [
    ent('board', 1, { board: { query: '.status=open' } }), // parses
    ent('board', 2, { board: { query: '' } }), // empty = every task
    ent('board', 3, { board: { query: '.status!open' } }), // throws
  ]
  let bad = brokenBoards(rows)
  assertEquals(bad.length, 1)
  assertEquals(bad[0].level, 'fail')
  assertEquals(bad[0].text.startsWith('B-3 '), true)
})

Deno.test('claim: a lease held by an ended (or vanished) session is a leak', () => {
  let sessions = [
    ent('session', 1, { session: { status: 'running' } }),
    ent('session', 2, { session: { status: 'exited' } }),
  ]
  let claimed = [
    ent('task', 10, { claim: { session: 'e-1' } }), // holder alive
    ent('task', 11, { claim: { session: 'e-2' } }), // holder ended
    ent('task', 12, { claim: { session: 'e-9' } }), // holder gone
  ]
  let bad = staleClaims(claimed, sessions)
  assertEquals(bad.map((r) => r.text.split(' ')[0]), ['T-11', 'T-12'])
  assertEquals(bad.every((r) => r.level == 'warn'), true)
})

Deno.test('session: stuck starting / stop unheard, but never a long run', () => {
  let now = Date.parse('2026-08-16T12:00:00Z')
  let ago = (h: number) => new Date(now - h * 3_600_000).toISOString()
  let rows = [
    ent('session', 1, { session: { status: 'starting', started_at: ago(3) } }),
    ent('session', 2, { session: { status: 'starting', started_at: ago(1) } }),
    ent('session', 3, { session: { status: 'running', started_at: ago(9) } }),
    ent('session', 4, {
      session: { status: 'stopping', stop_requested_at: ago(5) },
    }),
    ent('session', 5, {
      session: {
        status: 'stopping',
        stop_requested_at: ago(5),
        finished_at: ago(4),
      },
    }),
  ]
  let bad = stuckSessions(rows, now)
  assertEquals(bad.map((r) => r.text.split(' ')[0]), ['S-1', 'S-4'])
})

// The registry wiring: the mail check reads its book through the Querier and
// degrades to the static snapshot with no token, so an illegal fleet address
// is a hard finding end-to-end.
Deno.test('run: mailCheck through a querier flags an illegal fleet address', async () => {
  let q: Querier = (filters) =>
    Promise.resolve(
      filters.some((f) => f.includes('email'))
        ? [ent('project', 1, {
          project: {},
          doc: { title: 'p1' },
          email: { address: 'cafe_car@bot.test' },
        })]
        : [],
    )
  let [result] = await run([mailCheck], q)
  assertEquals(result.name, 'mail')
  assertEquals(result.reports.some((r) => r.level == 'fail'), true)
})

// A doctor that swallows its own breakage is the disease it treats: a check
// that throws becomes a loud fail, never a silent skip.
Deno.test('run: a crashing check becomes a hard finding, not a silent skip', async () => {
  let boom: Check = {
    name: 'boom',
    about: 'always throws',
    run: () => {
      throw new Error('kaboom')
    },
  }
  let q: Querier = () => Promise.resolve([])
  let [result] = await run([boom], q)
  assertEquals(result.reports.length, 1)
  assertEquals(result.reports[0].level, 'fail')
  assertEquals(result.reports[0].text.includes('kaboom'), true)
})

// Storage integrity (D-18866): orphaned component rows and dangling {eid}
// references are corruption the id-keyed schema rejects — each a hard fail. A
// clean scan says nothing; a server too old to carry /integrity answers null,
// reported as an UNVERIFIED warn rather than a false all-clear.
Deno.test('integrityReport: orphans and dangling refs are hard finds', () => {
  let out = integrityReport({
    orphans: { entry: 2, content: 1 },
    dangling: { 'conflict.target': 1, 'recalled.source': 465 },
  })
  assertEquals(out.length, 4)
  assertEquals(out.every((r) => r.level == 'fail'), true)
  assertEquals(out.some((r) => r.text.includes('entry: 2 orphaned')), true)
  assertEquals(
    out.some((r) => r.text.includes('recalled.source: 465 reference(s)')),
    true,
  )
})

Deno.test('integrityReport: a clean scan is silent', () => {
  assertEquals(integrityReport({ orphans: {}, dangling: {} }), [])
})

Deno.test('integrityReport: no /integrity route is an unverified warn', () => {
  let out = integrityReport(null)
  assertEquals(out.length, 1)
  assertEquals(out[0].level, 'warn')
  assertEquals(out[0].text.includes('UNVERIFIED'), true)
})

Deno.test('undispatched: an old pending deliverable warns; settled and fresh stay silent', () => {
  let now = Date.parse('2026-08-26T12:00:00Z')
  let old = '2026-08-26T11:00:00Z'
  let fresh = '2026-08-26T11:59:30Z'
  let rows = [
    // old and never settled — the finding
    ent('knock', 1, { deliver: { to: 'e-9' }, created: { at: old } }),
    // settled — silent
    ent('knock', 2, {
      deliver: { to: 'e-9' },
      created: { at: old },
      delivered: { at: old },
    }),
    // failed loudly — silent here (its own error is the record)
    ent('mail', 3, {
      deliver: { to: 'e-9' },
      created: { at: old },
      error: { at: old, message: 'no' },
    }),
    // fresh — inside the dispatch window
    ent('knock', 4, { deliver: { to: 'e-9' }, created: { at: fresh } }),
    // a wake is pending ON PURPOSE until its hour
    ent('wake', 5, {
      deliver: { to: 'e-9' },
      created: { at: old },
      wake: { at: '2026-08-26T13:00:00Z' },
    }),
    // a wake past its hour and unsettled — the finding
    ent('wake', 6, {
      deliver: { to: 'e-9' },
      created: { at: old },
      wake: { at: old },
    }),
    // inbound mail: arrival is its settlement
    ent('mail', 7, {
      deliver: { to: 'e-9' },
      created: { at: old },
      mail: { message_id: '<m>' },
    }),
  ]
  let out = undispatched(rows, now)
  assertEquals(out.length, 1)
  assertEquals(out[0].level, 'warn')
  assertEquals(out[0].text.includes('2 deliverable(s)'), true)
  assertEquals(undispatched([], now), [])
})
