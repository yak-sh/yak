import { equal, test, throws } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Env } from './env.ts'
import { mail } from './mail.ts'
import type { Binding } from '@yaks/cloudflare-mail'
import { outgoing } from './post.ts'

test('the app mail transport sinks recipients and keeps threading intact', async () => {
  let sent: Parameters<Binding['send']>[0][] = []
  let binding: Binding = {
    send: (letter) => {
      sent.push(letter)
      return Promise.resolve({ messageId: '<receipt>' })
    },
  }
  for (let MAIL_SINK of [undefined, 'owner@example.com']) {
    let receipt = await outgoing({ MAIL: binding, MAIL_SINK }).send({
      from: 'ada.recipes@yaks.fyi',
      to: 'reader@example.com',
      subject: 'Your recipe',
      text: 'The recipe',
      html: '<p>The recipe</p>',
      replyTo: 'previous',
    })
    assertEquals(receipt, { id: 'receipt' })
    assertEquals(sent.at(-1), {
      from: 'ada.recipes@yaks.fyi',
      to: MAIL_SINK ?? 'reader@example.com',
      subject: MAIL_SINK
        ? '[to: reader@example.com] Your recipe'
        : 'Your recipe',
      text: 'The recipe',
      html: '<p>The recipe</p>',
      headers: { 'In-Reply-To': '<previous>', References: '<previous>' },
    })
  }
})

test('platform letters sink every recipient, including feedback copies', async () => {
  let sent: Record<string, unknown>[] = []
  let original = globalThis.fetch
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return Promise.resolve(Response.json({ success: true }))
  }) as typeof fetch
  try {
    for (let MAIL_SINK of [undefined, 'owner@example.com']) {
      let env = {
        APEX: 'yaks.fyi',
        MAIL_SINK,
        MAIL_TOKEN: 'test',
        CF_ACCOUNT: 'test',
        MAIL_API: 'https://mail.example',
      } as Env
      for (
        let to of ['reader@example.com', [
          'reader@example.com',
          'task@example.com',
        ]]
      ) {
        await mail(env)({ to, subject: 'Code or feedback', body: 'The letter' })
        assertEquals(sent.at(-1)?.to, MAIL_SINK ? [MAIL_SINK] : [to].flat())
        assertEquals(
          sent.at(-1)?.subject,
          MAIL_SINK
            ? `[to: ${[to].flat().join(', ')}] Code or feedback`
            : 'Code or feedback',
        )
        assertEquals(sent.at(-1)?.reply_to, 'hello@yaks.fyi')
      }
    }
  } finally {
    globalThis.fetch = original
  }
})

// The binding names a refusal by its code: a rate limit never let the letter
// leave, so the sending effect may try it again; any other refusal may have
// sent it, and bounces.
test('a rate-limited app letter is unsent, any other refusal is not', async () => {
  let refusing = (code: string): Binding => ({
    send: () => Promise.reject(Object.assign(new Error(code), { code })),
  })
  let letter = {
    from: 'ada.recipes@yaks.fyi',
    to: 'reader@example.com',
    subject: 'Your recipe',
    text: 'The recipe',
    html: '<p>The recipe</p>',
  }
  let named = (code: string) =>
    outgoing({ MAIL: refusing(code) }).send(letter).then(
      () => '',
      (e: Error) => e.name,
    )
  assertEquals(await named('E_RATE_LIMIT_EXCEEDED'), 'Unsent')
  assertEquals(await named('E_DELIVERY_FAILED'), 'Error')
})

let message = {
  from: 'ada@yaks.app',
  name: 'Assistant',
  to: 'clerk@example.com',
  cc: 'ada@example.com',
  subject: 'A meeting',
  text: 'Thursday?',
  html: '<p>Thursday?</p>',
  replyTo: 'prior@example.com',
}

test('the host Resend capability sends app and Operator mail through the staging sink', async () => {
  let requests: Record<string, unknown>[] = []
  let sender = outgoing({
    MAIL_VIA: 'resend',
    RESEND_TOKEN: 'sending-only',
    MAIL_SINK: 'sink@example.com',
    MAIL: {
      send: () => {
        throw new Error('Cloudflare must not send')
      },
    } satisfies Binding,
    MAIL_FETCH: (_url, init) => {
      requests.push(JSON.parse(String(init.body)))
      return Promise.resolve(Response.json({ id: 'provider-id' }))
    },
  })
  await sender.send(message)
  equal(requests.length, 1)
  equal(requests[0].from, 'Assistant <ada@yaks.app>')
  equal(requests[0].to, ['sink@example.com'])
  equal(requests[0].cc, undefined)
  equal(requests[0].subject, '[to: clerk@example.com] A meeting')
  equal(requests[0].headers, {
    'In-Reply-To': '<prior@example.com>',
    References: '<prior@example.com>',
  })
})

test('an unconfigured selected sender never falls back to the host binding', async () => {
  let sender = outgoing({
    MAIL_VIA: 'resend',
    MAIL: {
      send: () => {
        throw new Error('Cloudflare must not send')
      },
    } satisfies Binding,
  })
  await throws(() => sender.send(message), 'a resend sender needs `token`')
})
