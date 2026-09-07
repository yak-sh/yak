import { assertEquals } from '@std/assert'
import type { Env } from './env.ts'
import { mail } from './mail.ts'
import { type Binding, posting } from './post.ts'

Deno.test('the app mail transport sinks recipients and keeps threading intact', async () => {
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

Deno.test('platform letters sink every recipient, including feedback copies', async () => {
  let sent: Record<string, unknown>[] = []
  let original = globalThis.fetch
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return Promise.resolve(new Response('{}'))
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
