// The doctor's pure seams: the book (who counts), the diagnosis (what
// fails), and the static snapshot's own hygiene. Degrade mode only —
// CI must never touch Cloudflare; liveRules is an operator's path,
// exercised by running `task mail doctor` with a routing-read token.
import { bookOf, diagnose, type Rules, STATIC_RULES } from './doctor.ts'
import { canon } from './mailer.ts'
import type { Row } from './client.ts'
import { assertEquals } from '@std/assert'

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
    row(1, 'a@bot.yak.sh'),
    row(2, 'gone@bot.yak.sh', { project: { retired_at: '2026-07-21' } }),
    { eid: 'e-3', num: 3, kind: 'task', comps: { doc: { title: 't' } } },
  ]
  assertEquals(bookOf(all), [{ address: 'a@bot.yak.sh', owner: 'P-1 p1' }])
})

Deno.test('diagnose: a ruled address is deliverable', () => {
  let book = [{ address: 'a@bot.yak.sh', owner: 'P-1' }]
  assertEquals(diagnose(book, rules(['a@bot.yak.sh'])), [])
})

Deno.test('diagnose: no rule + catch-all off = the silent drop', () => {
  let bad = diagnose([{ address: 'b@bot.yak.sh', owner: 'P-2' }], rules([]))
  assertEquals(bad.length, 1)
  assertEquals(bad[0].address, 'b@bot.yak.sh')
})

Deno.test('diagnose: the catch-all covers what no rule names', () => {
  let book = [{ address: 'b@bot.yak.sh', owner: 'P-2' }]
  assertEquals(diagnose(book, rules([], true)), [])
})

Deno.test('diagnose: a disabled rule is no rule', () => {
  let r: Rules = {
    live: false,
    catchall: false,
    rules: [{ value: 'c@bot.yak.sh', enabled: false }],
  }
  assertEquals(
    diagnose([{ address: 'c@bot.yak.sh', owner: 'P-3' }], r).length,
    1,
  )
})

Deno.test('diagnose: rule match is case-insensitive', () => {
  let book = [{ address: 'd@bot.yak.sh', owner: 'P-4' }]
  assertEquals(diagnose(book, rules(['D@BOT.YAK.SH'])), [])
})

Deno.test('diagnose: an underscore local-part fails even with a rule', () => {
  let book = [{ address: 'cafe_car@bot.yak.sh', owner: 'P-5' }]
  let bad = diagnose(book, rules(['cafe_car@bot.yak.sh'], true))
  assertEquals(bad.length, 1)
  assertEquals(bad[0].problem.includes('cafecar@bot.yak.sh'), true)
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
