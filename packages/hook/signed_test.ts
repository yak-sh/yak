import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { checked, ours, refusal, type Scheme, SKEW } from './signed.ts'

let SECRET = 'whsec_a_probe_secret'
let NOW = 1_788_460_000_000
let SEC = Math.floor(NOW / 1000)
let enc = new TextEncoder()

let mac = async (secret: string, payload: string) =>
  new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
      enc.encode(payload),
    ),
  )
let hex = (b: Uint8Array) =>
  [...b].map((n) => n.toString(16).padStart(2, '0')).join('')
let b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

// What Stripe puts on the wire: `t=<unix>,v1=<hmac of "t.body">`.
let stripe = async (raw: string, at: number, secret = SECRET) =>
  `t=${at},v1=${hex(await mac(secret, `${at}.${raw}`))}`

let ask = (scheme: Scheme, raw: string, headers: Record<string, string>) =>
  refusal(scheme, SECRET, raw, new Headers(headers), NOW)

test('stripe: the exact bytes verify; a moved byte or another secret does not', async () => {
  let raw = '{"id":"evt_1","type":"invoice.paid"}'
  let sig = await stripe(raw, SEC)
  assertEquals(
    [
      await ask('stripe', raw, { 'stripe-signature': sig }),
      await ask('stripe', `${raw} `, { 'stripe-signature': sig }),
      await ask('stripe', raw, {
        'stripe-signature': await stripe(raw, SEC, 'whsec_someone_else'),
      }),
    ],
    ['', 'the signature does not match', 'the signature does not match'],
  )
})

test('stripe: a stale timestamp is refused, and the edge is the edge', async () => {
  let raw = '{"id":"evt_1"}'
  let at = async (t: number) =>
    await ask('stripe', raw, { 'stripe-signature': await stripe(raw, t) })
  assertEquals(
    [await at(SEC - SKEW - 1), await at(SEC - SKEW + 1)],
    ['the signature is too old', ''],
  )
})

test('stripe: a header missing its parts is refused, never thrown past', async () => {
  let sent = (v: string | null) =>
    ask('stripe', '{}', v == null ? {} : { 'stripe-signature': v })
  assertEquals(
    await Promise.all(
      [null, 'v1=abcd', `t=${SEC}`, `t=${SEC},v1=zzzz`, `t=${SEC},v1=abc`]
        .map(sent),
    ),
    [
      'no Stripe-Signature header',
      'no timestamp on the signature',
      'the signature is not well formed',
      'the signature is not well formed',
      'the signature is not well formed',
    ],
  )
})

test('ours: only a complete, fresh, well-formed signature that fails can be our secret', async () => {
  let raw = '{"id":"evt_1"}'
  let sent = async (v?: string) =>
    ours(await ask('stripe', raw, v == null ? {} : { 'stripe-signature': v }))
  assertEquals(
    await Promise.all([
      sent(),
      sent(`t=${SEC},v1=beef`),
      sent(await stripe(raw, SEC - SKEW - 1, 'whsec_someone_else')),
      sent(await stripe(raw, SEC, 'whsec_someone_else')),
      sent(await stripe(raw, SEC)),
    ]),
    [false, false, false, true, false],
  )
})

test('stripe: a rolled secret sends both signatures and either may match', async () => {
  let raw = '{"id":"evt_1"}'
  let mine = await stripe(raw, SEC)
  let theirs = await stripe(raw, SEC, 'whsec_the_old_one')
  // The one that matches arrives second: a Map keyed by name would have kept
  // only the last and thrown ours away.
  assertEquals(
    await ask('stripe', raw, {
      'stripe-signature': `${theirs},${mine.split(',')[1]}`,
    }),
    '',
  )
})

test('github: sha256= and the hex of the body', async () => {
  let raw = '{"zen":"Keep it logically awesome."}'
  let good = `sha256=${hex(await mac(SECRET, raw))}`
  let h = (v: string) => ({ 'x-hub-signature-256': v })
  assertEquals(
    [
      await ask('github', raw, h(good)),
      await ask('github', `${raw} `, h(good)),
      await ask('github', raw, h(good.slice('sha256='.length))),
      await ask('github', raw, {}),
    ],
    [
      '',
      'the signature does not match',
      'the signature is not well formed',
      'no X-Hub-Signature-256 header',
    ],
  )
})

// A digest of a form body, and the two named-header schemes that carry it.
let form = 'a=1&b=2'
let formMac = await mac(SECRET, form)
let hexed: Scheme = { header: 'X-Signature' }
let based: Scheme = { header: 'X-Shopify-Hmac-Sha256', encoding: 'base64' }

test('hmac: a named header carries the digest in hex', async () => {
  assertEquals(
    [
      await ask(hexed, form, { 'x-signature': hex(formMac) }),
      await ask(hexed, form, { 'x-signature': b64(formMac) }),
    ],
    ['', 'the signature is not well formed'],
  )
})

test('hmac: a named header may carry it in base64', async () => {
  assertEquals(
    [
      await ask(based, form, { 'x-shopify-hmac-sha256': b64(formMac) }),
      await ask(based, form, { 'x-shopify-hmac-sha256': '%%%' }),
    ],
    ['', 'the signature is not well formed'],
  )
})

let opened = '{"action":"opened"}'
let openedMac = await mac(SECRET, opened)
test('checked: a captured request carries the answer in verified', async () => {
  let body = opened
  let headers = JSON.stringify({
    'X-Hub-Signature-256': `sha256=${hex(openedMac)}`,
  })
  let r = { id: '1', source: 'gh', body, headers }
  assertEquals(
    [
      (await checked(r, 'github', SECRET, NOW)).verified,
      (await checked(r, 'github', 'another', NOW)).verified,
      (await checked({ ...r, headers: 'not json' }, 'github', SECRET, NOW))
        .verified,
    ],
    [true, false, false],
  )
})

// Telnyx's: Ed25519 over `<t>|<body>` under its public key.
let pair = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]) as CryptoKeyPair
let telnyxKey = b64(
  new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
)
let telnyx = async (raw: string, at: number) => ({
  'telnyx-timestamp': String(at),
  'telnyx-signature-ed25519': b64(
    new Uint8Array(
      await crypto.subtle.sign(
        'Ed25519',
        pair.privateKey,
        enc.encode(`${at}|${raw}`),
      ),
    ),
  ),
})
test("telnyx: Ed25519 over the time and the body, under Telnyx's public key", async () => {
  let raw = '{"data":{"event_type":"message.received"}}'
  let said = (body: string, headers: Record<string, string>, key = telnyxKey) =>
    refusal('telnyx', key, body, new Headers(headers), NOW)
  let good = await telnyx(raw, SEC)
  let other = b64(new Uint8Array(32).fill(7))
  let why = await Promise.all([
    said(raw, good),
    said(`${raw} `, good),
    said(raw, good, other),
    said(raw, await telnyx(raw, SEC - SKEW - 1)),
    said(raw, { ...good, 'telnyx-signature-ed25519': 'AAAA' }),
    said(raw, { 'telnyx-timestamp': String(SEC) }),
  ])
  assertEquals(why, [
    '',
    'the signature does not match',
    'the signature does not match',
    'the signature is too old',
    'the signature is not well formed',
    'no telnyx-signature-ed25519 header',
  ])
  assertEquals(why.map(ours), [false, true, true, false, false, false])
})

// What Standard Webhooks (OpenAI) puts on the wire: `v1,<base64 hmac>` of
// `id.timestamp.body` under the bytes the secret's base64 names.
let standard = async (raw: string, at: number, key = 'a probe key') => ({
  'webhook-id': 'wh_1',
  'webhook-timestamp': String(at),
  'webhook-signature': `v1,${b64(await mac(key, `wh_1.${at}.${raw}`))}`,
})

test('standard: an HMAC of the id, time and body under the secret’s bytes, any of several', async () => {
  let raw = '{"type":"realtime.call.incoming"}'
  let secret = `whsec_${btoa('a probe key')}`
  let said = (body: string, headers: Record<string, string>) =>
    refusal('standard', secret, body, new Headers(headers), NOW)
  let good = await standard(raw, SEC)
  let other = await standard(raw, SEC, 'another key')
  let why = await Promise.all([
    said(raw, good),
    said(raw, {
      ...good,
      'webhook-signature': `${other['webhook-signature']} ${
        good['webhook-signature']
      }`,
    }),
    said(`${raw} `, good),
    said(raw, other),
    said(raw, await standard(raw, SEC - SKEW - 1)),
    said(raw, { ...good, 'webhook-signature': 'v1,AAAA' }),
    said(raw, { 'webhook-timestamp': String(SEC) }),
  ])
  assertEquals(why, [
    '',
    '',
    'the signature does not match',
    'the signature does not match',
    'the signature is too old',
    'the signature is not well formed',
    'no webhook-signature header',
  ])
})
