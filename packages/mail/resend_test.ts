// Provider requests and the distinction between an API receipt and a thread id.
import { equal, test, throws } from '@yaks/testing'
import { Unsent } from '@yaks/host/senders'
import { resend } from './resend.ts'
import { post } from './transport.ts'
import type { Message } from './send.ts'

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

test('an invalid acceptance is an ambiguous failure, never a retry', async () => {
  await throws(() =>
    resend({
      token: 'sending-only',
      fetch: () => Promise.resolve(Response.json({})),
    }).send(message), 'Resend accepted no email id')
})

test('missing Resend credentials keep the selected transport waiting', () => {
  equal(post({ via: 'resend' }), {
    waiting: 'waiting for credentials: a resend sender needs `token`',
  })
})

test('changing only the selected provider changes credentials and preserves the letter', async () => {
  let seen: string[] = []
  let selection = {
    via: 'cloudflare',
    providers: {
      cloudflare: { account: 'account', token: 'cf-token' },
      resend: { token: 'resend-token' },
    },
    fetch: (url: string, init: RequestInit) => {
      seen.push(
        `${new URL(url).hostname} ${
          new Headers(init.headers).get('authorization')
        }`,
      )
      return Promise.resolve(
        Response.json(
          url.includes('/accounts/') ? { success: true } : { id: 'api-id' },
        ),
      )
    },
  }
  await post(selection).sender!.send(message)
  selection.via = 'resend'
  await post(selection).sender!.send(message)
  equal(seen, [
    'api.cloudflare.com Bearer cf-token',
    'api.resend.com Bearer resend-token',
  ])
})
