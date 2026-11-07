import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import {
  base64url,
  bytesOf,
  messageKeys,
  MOST,
  publicKey,
  push,
  pushRequest,
  shared,
  Unpushed,
  vapidKey,
} from './mod.ts'
import { browser } from './testing.ts'

let vapid = { key: await vapidKey(), subject: 'mailto:hello@yaks.app' }
let ana = await browser('https://push.example/send/ana')
let answer = (status: number) => (request: Request) => {
  heard.push(request)
  return Promise.resolve(new Response(null, { status }))
}
let heard: Request[] = []

test('a push is encrypted for its browser alone and signed by the site', async () => {
  assertEquals(
    await push(ana.subscription, 'Your report is ready.', vapid, answer(201)),
    'sent',
  )
  let [request] = heard.splice(0)
  let copy = request.clone()
  assertEquals(request.headers.get('content-encoding'), 'aes128gcm')
  let opened = await ana.opened(request)
  assertEquals(opened.payload, 'Your report is ready.')
  assertEquals(opened.key, publicKey(vapid.key))
  assertEquals(opened.claims.aud, 'https://push.example')
  assertEquals(opened.claims.sub, 'mailto:hello@yaks.app')
  let bo = await browser(ana.subscription.endpoint)
  await assertRejects(() => bo.opened(copy))
})

test('a subscription the service no longer has is gone; any other refusal is an error', async () => {
  assertEquals(await push(ana.subscription, 'hi', vapid, answer(410)), 'gone')
  assertEquals(await push(ana.subscription, 'hi', vapid, answer(404)), 'gone')
  await assertRejects(
    () => push(ana.subscription, 'hi', vapid, answer(429)),
    Unpushed,
  )
})

test('a push carries one record of words at most', async () => {
  let full = await pushRequest(
    ana.subscription,
    'é'.repeat(Math.floor(MOST / 2)),
    vapid,
  )
  assertEquals((await ana.opened(full)).payload.length, Math.floor(MOST / 2))
  await assertRejects(
    () => pushRequest(ana.subscription, 'x'.repeat(MOST + 1), vapid),
    RangeError,
  )
})

// RFC 8291 Appendix A: the browser's side of the example message.
test("a message's keys are derived as RFC 8291's example derives them", async () => {
  let ua = bytesOf(
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  )
  let as = bytesOf(
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  )
  let own = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
      x: base64url(ua.slice(1, 33)),
      y: base64url(ua.slice(33)),
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  let secret = await shared(own, as)
  assertEquals(base64url(secret), 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs')
  let { key, nonce } = await messageKeys(
    secret,
    bytesOf('BTBZMqHH6r4Tts7J_aSIgg'),
    ua,
    as,
    bytesOf('DGv6ra1nlYgDCS1FRnbzlw'),
  )
  assertEquals(base64url(nonce), '4h_95klXJ5E_qnoN')
  let sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    bytesOf('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24C'),
  )
  assertEquals(
    base64url(sealed),
    '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
  )
})
