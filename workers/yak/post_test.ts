import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Env } from './env.ts'
import { mail } from './mail.ts'
import { type Binding, posting } from './post.ts'

test('the app mail transport sinks recipients and keeps threading intact', async () => {
  let sent: Parameters<Binding['send']>[0][] = []
  let binding: Binding = {
    send: (letter) => {
      sent.push(letter)
      return Promise.resolve({ messageId: '<receipt>' })
    },
  }
  for (let MAIL_SINK of [undefined, 'owner@example.com']) {
    let receipt = await posting(binding, { MAIL_SINK }).send({
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
        MAIL_ACCOUNT: 'test',
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
    posting(refusing(code)).send(letter).then(() => '', (e: Error) => e.name)
  assertEquals(await named('E_RATE_LIMIT_EXCEEDED'), 'Unsent')
  assertEquals(await named('E_DELIVERY_FAILED'), 'Error')
})
