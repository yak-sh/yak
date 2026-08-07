// The doctor's pure seams: the book (who counts), the diagnosis (what
// fails), and the static snapshot's own hygiene. Degrade mode only —
// CI must never touch Cloudflare; liveRules is an operator's path,
// exercised by running `task mail doctor` with a routing-read token.
import { bookOf, diagnose, type Rules, STATIC_RULES } from './doctor.ts'
import { canon } from './mailer.ts'
import type { Row } from './client.ts'
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
    project: { retired_at: null },
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
    row(2, 'gone@bot.test', { project: { retired_at: '2026-07-21' } }),
    { eid: 'e-3', num: 3, kind: 'task', comps: { doc: { title: 't' } } },
  ]
  assertEquals(bookOf(all), [{ address: 'a@bot.test', owner: 'P-1 p1' }])
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
