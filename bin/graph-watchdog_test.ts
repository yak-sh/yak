// Pure seams of the graph watchdog: how checks classify into health, when a
// page fires, and reading the two secrets out of an .env file. The live probe
// and the Cloudflare send are impure edges, exercised by hand, not here.
import { assertEquals } from '@std/assert'
import { classify, decideAlert, readEnv } from './graph-watchdog.ts'

let chk = (ok: boolean, pid: number | null, flapped = false) => ({
  t: 0,
  ok,
  pid,
  flapped,
})

Deno.test('classify: answering now is healthy', () => {
  assertEquals(classify([chk(true, 100)]), 'healthy')
  assertEquals(classify([chk(false, 100), chk(true, 100)]), 'healthy')
})

Deno.test('classify: two trailing failures is down', () => {
  assertEquals(
    classify([chk(true, 100), chk(false, null), chk(false, null)]),
    'down',
  )
})

Deno.test('classify: one failed check is an unconfirmed blip, not down', () => {
  // debounce: a lone timeout must not page — down needs DOWN_N consecutive fails
  assertEquals(classify([chk(true, 100), chk(false, null)]), 'healthy')
  assertEquals(classify([chk(false, 100)]), 'healthy')
})

Deno.test('classify: pid churn across runs is crashloop even with some 200s', () => {
  let h = [chk(true, 1), chk(false, 2), chk(true, 3)]
  assertEquals(classify(h), 'crashloop') // 3 distinct pids in window
})

Deno.test('classify: intra-run flap is crashloop immediately', () => {
  assertEquals(classify([chk(true, 7, true)]), 'crashloop')
})

Deno.test('classify: stable pid, all healthy, is healthy', () => {
  assertEquals(classify([chk(true, 5), chk(true, 5), chk(true, 5)]), 'healthy')
})

Deno.test('classify: empty history is healthy', () => {
  assertEquals(classify([]), 'healthy')
})

Deno.test('decideAlert: healthy→down pages down at once', () => {
  assertEquals(decideAlert('healthy', 'down', 0, 1000), 'down')
})

Deno.test('decideAlert: healthy→crashloop pages crashloop', () => {
  assertEquals(decideAlert('healthy', 'crashloop', 0, 1000), 'crashloop')
})

Deno.test('decideAlert: steady healthy is silent', () => {
  assertEquals(decideAlert('healthy', 'healthy', 0, 9e9), null)
})

Deno.test('decideAlert: ongoing outage is silent within the reminder window', () => {
  assertEquals(decideAlert('down', 'down', 1000, 1000 + 60_000), null)
})

Deno.test('decideAlert: ongoing outage re-pages past the reminder window', () => {
  assertEquals(decideAlert('down', 'down', 0, 31 * 60_000), 'down-reminder')
})

Deno.test('decideAlert: down→crashloop is a fresh transition, pages now', () => {
  // crashloop is "bad" and so was down, so it re-pages only past REMINDER —
  // deliberate: churn while already-alerted is not a new outage.
  assertEquals(decideAlert('down', 'crashloop', 0, 1000), null)
  assertEquals(
    decideAlert('down', 'crashloop', 0, 31 * 60_000),
    'crashloop-reminder',
  )
})

Deno.test('decideAlert: recovery pages once on the way back up', () => {
  assertEquals(decideAlert('crashloop', 'healthy', 5000, 6000), 'recovery')
  assertEquals(decideAlert('healthy', 'healthy', 5000, 6000), null)
})

Deno.test('readEnv: pulls a key, ignores comments and quotes, honors last write', () => {
  let env = [
    '# a comment mentioning CLOUDFLARE_EMAIL_TOKEN=notthis',
    'HOLDCO_CF_ACCOUNT_ID = 0f9613df ',
    'CLOUDFLARE_EMAIL_TOKEN="cfat_secret"',
    '',
  ].join('\n')
  assertEquals(readEnv(env, 'HOLDCO_CF_ACCOUNT_ID'), '0f9613df')
  assertEquals(readEnv(env, 'CLOUDFLARE_EMAIL_TOKEN'), 'cfat_secret')
  assertEquals(readEnv(env, 'MISSING'), undefined)
})
