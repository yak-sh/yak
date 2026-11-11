// Provider requests and the distinction between an API receipt and a thread id.
import { equal, test, throws } from '@yaks/testing'
import { type Message, Undeliverable, Unsent } from '@yaks/host/senders'
import { resend } from './sender.ts'
import { senders } from './graph.ts'

let message: Message = {
  from: 'hello@books.example',
  name: 'Book club',
  to: ['ana@example.com', 'ben@example.com'],
  cc: 'chair@example.com',
  replyAddress: 'replies@books.example',
  replyTo: 'prior@example.com',
  subject: 'Thursday',
  text: 'At seven.',
  html: '<p>At seven.</p>',
}

test('Resend sends every reader in one request with the reply address and thread', async () => {
  let requests: [string, RequestInit][] = []
  let sender = resend({
    token: 'sending-only',
    base: 'https://mail.test/',
    fetch: (url, init) => {
      requests.push([url, init])
      return Promise.resolve(Response.json({ id: 'api-id' }))
    },
  })
  // A Resend API UUID cannot match In-Reply-To. Never store it as Message-ID.
  equal(await sender.send(message), {})
  equal(requests.length, 1)
  let [url, init] = requests[0]
  equal(url, 'https://mail.test/emails')
  equal(init.method, 'POST')
  equal(new Headers(init.headers).get('authorization'), 'Bearer sending-only')
  equal(JSON.parse(String(init.body)), {
    tags: [],
    from: 'Book club <hello@books.example>',
    to: ['ana@example.com', 'ben@example.com'],
    cc: ['chair@example.com'],
    reply_to: 'replies@books.example',
    subject: 'Thursday',
    text: 'At seven.',
    html: '<p>At seven.</p>',
    headers: {
      'In-Reply-To': '<prior@example.com>',
      References: '<prior@example.com>',
    },
  })
})

test('a subject-only letter supplies nonempty HTML without changing its text', async () => {
  let sent = resend({
    token: 'sending-only',
    fetch: (_url, init) => {
      let payload = JSON.parse(String(init.body))
      equal(payload.text, '')
      equal(payload.html, '<div></div>')
      return Promise.resolve(Response.json({ id: 'api-id' }))
    },
  })
  await sent.send({ ...message, text: '', html: '' })
})

test('only a definite nonacceptance permits a Resend retry', async () => {
  for (let status of [429, 400, 401, 403, 500, 503]) {
    let calls = 0
    let sender = resend({
      token: 'sending-only',
      fetch: () => {
        calls++
        return Promise.resolve(
          new Response('private echoed content', {
            status,
            headers: { 'retry-after': '7' },
          }),
        )
      },
    })
    let error = await sender.send(message).catch((e) => e)
    equal(error instanceof Unsent, [429, 401, 403].includes(status))
    equal(error.message.includes('private echoed content'), false)
    equal(calls, 1)
    if (status == 429) equal(error.retry.after, 7000)
  }
  let refused = await resend({
    token: 'bot-only',
    fetch: () =>
      Promise.resolve(Response.json({
        statusCode: 403,
        message: 'This API key is not authorized to send emails from yaks.app',
      }, { status: 403 })),
  }).send(message).catch((e) => e)
  equal(
    refused.message,
    'Resend refused the key (HTTP 403): This API key is not authorized to send emails from yaks.app',
  )
  for (let reason of ['client error (Connect): TLS', 'connection closed']) {
    let error = await resend({
      token: 'sending-only',
      fetch: () => Promise.reject(new TypeError(reason)),
    }).send(message).catch((e) => e)
    equal(error instanceof Unsent, reason.includes('(Connect)'))
  }
})

// What a 422 with Resend's error body rejects as.
let refusing = (body: Record<string, string>) =>
  resend({
    token: 'sending-only',
    fetch: () =>
      Promise.resolve(Response.json({ statusCode: 422, ...body }, {
        status: 422,
      })),
  }).send(message).catch((e) => e)

test('a refusal that names a reader is the letter undeliverable', async () => {
  for (
    let said of [
      'Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.',
      'Ana@Example.com is not a deliverable address',
    ]
  ) {
    let error = await refusing({ name: 'validation_error', message: said })
    equal(error instanceof Undeliverable, true)
    equal(
      error.message,
      `Resend refused the recipient (HTTP 422): ${said}`,
    )
  }
  // Any other refusal is a failure that says Resend's code, never its body.
  let error = await refusing({
    name: 'invalid_from_address',
    message: 'Invalid `from` field: Thursday at seven',
  })
  equal(error instanceof Undeliverable, false)
  equal(error.message, 'Resend send failed (HTTP 422 invalid_from_address)')
})

test('an invalid acceptance is an ambiguous failure, never a retry', async () => {
  await throws(() =>
    resend({
      token: 'sending-only',
      fetch: () => Promise.resolve(Response.json({})),
    }).send(message), 'Resend accepted no email id')
})

test('the lent sender waits for its token, read at every letter', async () => {
  let options: { token?: string; fetch?: typeof fetch } = {}
  let { resend: lent } = senders(null, options)
  equal(
    lent.waiting?.(),
    'waiting for credentials: a resend sender needs `token`',
  )
  equal((await lent.send(message).catch((e) => e)) instanceof Unsent, true)
  let seen: string[] = []
  options.token = 'set-later'
  options.fetch = (_url, init) => {
    seen.push(new Headers(init?.headers).get('authorization')!)
    return Promise.resolve(Response.json({ id: 'api-id' }))
  }
  equal(lent.waiting?.(), undefined)
  equal(await lent.send(message), {})
  equal(seen, ['Bearer set-later'])
})
