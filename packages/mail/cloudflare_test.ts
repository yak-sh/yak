import { assertEquals, assertRejects } from '@std/assert'
import { cloudflare, type Fetch, payload } from './cloudflare.ts'
import type { Message } from './send.ts'

let m: Message = {
  from: 'hello@books.example',
  to: 'ana@books.example',
  subject: 'Potluck',
  text: 'Bring a dish.',
  html: '<p>Bring a dish.</p>',
}

Deno.test('payload: the display name is the local part; a reply carries headers', () => {
  assertEquals(payload(m), {
    from: { address: 'hello@books.example', name: 'hello' },
    to: ['ana@books.example'],
    reply_to: 'hello@books.example',
    subject: 'Potluck',
    text: 'Bring a dish.',
    html: '<p>Bring a dish.</p>',
  })
  assertEquals(payload({ ...m, replyTo: 'a1@x.example' }).headers, {
    'In-Reply-To': '<a1@x.example>',
    References: '<a1@x.example>',
  })
})

let answers = (body: string, status = 200): [Fetch, string[]] => {
  let seen: string[] = []
  return [
    (url, init) => {
      seen.push(`${init.method} ${url}`)
      seen.push(String(init.body))
      return Promise.resolve(new Response(body, { status }))
    },
    seen,
  ]
}

Deno.test('cloudflare: the message id comes back unbracketed', async () => {
  let [call, seen] = answers(
    JSON.stringify({ success: true, result: { message_id: '<a1@x.example>' } }),
  )
  let sender = cloudflare({
    account: 'acct',
    token: 'tok',
    base: 'https://api.test/',
    fetch: call,
  })
  assertEquals(await sender.send(m), { id: 'a1@x.example' })
  assertEquals(
    seen[0],
    'POST https://api.test/accounts/acct/email/sending/send',
  )
  assertEquals(JSON.parse(seen[1]).to, ['ana@books.example'])
})

Deno.test('cloudflare: a refusal rejects with what the API said', async () => {
  let [call] = answers('{"success":false,"errors":["no such domain"]}', 403)
  let sender = cloudflare({ account: 'a', token: 't', fetch: call })
  await assertRejects(
    () => sender.send(m),
    Error,
    'send failed (HTTP 403): {"success":false,"errors":["no such domain"]}',
  )
  // and a body that is not JSON at all still reaches the caller
  let [plain] = answers('gateway timeout', 504)
  await assertRejects(
    () => cloudflare({ account: 'a', token: 't', fetch: plain }).send(m),
    Error,
    'HTTP 504',
  )
})
