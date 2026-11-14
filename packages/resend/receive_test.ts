// Signed receipts and receiving bytes are checked at the HTTP boundary.
import { equal, test, throws } from '@yaks/testing'
import { event, notification, receipt, received } from './receive.ts'

let secret = 'whsec_' + btoa('a shared endpoint key for testing')
let at = 1_800_000_000
let letter = '21491aa7-e2c1-4631-8465-0414f7195261'
let body = JSON.stringify({
  type: 'email.sent',
  data: {
    email_id: 'provider-only',
    message_id: '<thread@example.com>',
    tags: { yak_letter: letter, yak_host: 'box' },
  },
})
let encoder = new TextEncoder()
let key = await crypto.subtle.importKey(
  'raw',
  encoder.encode('a shared endpoint key for testing'),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
)
let now = () => Math.floor(Date.now() / 1000)
let signed = async (raw = body, time = at) => {
  let signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`event-id.${time}.${raw}`),
  )
  return new Request('https://mail.example/mail/resend', {
    method: 'POST',
    body: raw,
    headers: {
      'svix-id': 'event-id',
      'svix-timestamp': String(time),
      'svix-signature': 'v1,' +
        btoa(String.fromCharCode(...new Uint8Array(signature))),
    },
  })
}

test('a verified webhook returns a neutral receipt without its provider email id', async () => {
  let arrived = await event(await signed(), secret, at * 1000)
  equal(receipt(arrived), { letter, id: 'thread@example.com' })
  equal(receipt({ type: 'email.received', data: {} }), undefined)
})

test('a forged or stale webhook cannot write a receipt', async () => {
  let request = await signed()
  await throws(
    () => event(new Request(request, { body: body + ' ' }), secret, at * 1000),
    'signature does not match',
  )
  await throws(
    async () => event(await signed(body, at - 301), secret, at * 1000),
    'fresh signed timestamp',
  )
})

test('receiving preserves all recipients and attachment bytes without forwarding the key', async () => {
  let calls: string[] = []
  let letters = await received({
    token: 'receiving-only-fixture',
    fetch: (url, init) => {
      calls.push(url)
      if (url == 'https://files.example/attachment') {
        equal(init?.headers, undefined)
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
      }
      equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer receiving-only-fixture',
      )
      return Promise.resolve(Response.json(
        url.endsWith('/attachments')
          ? {
            data: [{
              download_url: 'https://files.example/attachment',
              filename: 'note.txt',
              content_type: 'text/plain',
            }],
          }
          : {
            from: 'Ann <ann@example.com>',
            to: ['one@books.example', 'Two@books.example'],
            cc: ['two@books.example', 'three@books.example'],
            message_id: '<inbound@example.com>',
            subject: 'Note',
            text: 'See attached',
            headers: { 'In-Reply-To': '<prior@example.com>' },
            attachments: [{}],
          },
      ))
    },
  }, 'provider-id')
  equal(calls.length, 3)
  equal(letters.map((m) => m.to), [
    'one@books.example',
    'two@books.example',
    'three@books.example',
  ])
  equal(letters[0].name, 'Ann')
  equal(letters[0].from, 'ann@example.com')
  equal(letters[0].headers.get('from'), 'ann@example.com')
  equal(letters[0].headers.get('in-reply-to'), '<prior@example.com>')
  equal(letters[0].text, 'See attached')
  equal(letters[0].verified, undefined)
  equal(letters[0].attachments, [{
    name: 'note.txt',
    type: 'text/plain',
    bytes: new Uint8Array([1, 2, 3]),
  }])
})

for (
  let [authentication, verified, vouched] of [
    [{ dkim: 'pass', dmarc: 'gray' }, true, false],
    [{ dkim: 'fail', dmarc: 'pass' }, false, true],
    [{ dkim: 'fail', dmarc: 'fail' }, false, false],
    [null, undefined, false],
  ] as const
) {
  test(`receiving trusts the server verdict ${JSON.stringify(authentication)}`, async () => {
    let [mail] = await received({
      token: 'fixture',
      fetch: () =>
        Promise.resolve(Response.json({
          from: 'author@example.com',
          to: ['reader@example.com'],
          message_id: '<incoming@example.com>',
          headers: {
            'authentication-results': 'forged; dkim=pass; dmarc=pass',
          },
          authentication,
        })),
    }, 'incoming')
    equal([mail.verified, mail.vouched], [verified, vouched])
  })
}

test('a received event is read in full only where the host takes mail in', async () => {
  let raw = JSON.stringify({
    type: 'email.received',
    data: { email_id: 'incoming' },
  })
  let receiving = {
    token: 'full-access',
    fetch: () =>
      Promise.resolve(Response.json({
        from: 'author@example.com',
        to: ['reader@example.com'],
        message_id: '<incoming@example.com>',
        text: 'Hello.',
      })),
  }
  equal(await notification(await signed(raw, now()), secret), {})
  let { letters } = await notification(
    await signed(raw, now()),
    secret,
    receiving,
  )
  equal(letters?.map((m) => [m.to, m.text]), [['reader@example.com', 'Hello.']])
  await throws(
    async () =>
      notification(await signed(raw, now()), secret, {
        ...receiving,
        token: undefined,
      }),
    'receiving key is not configured',
  )
})
