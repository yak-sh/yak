// Reopening configured mail writes only a changed recipient.
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { options, platform, vocab } from './core.ts'
import { activate, activation, sender } from './mail.ts'

let env = {
  MAIL: { send: () => Promise.resolve({}) },
  MAIL_FROM: 'tracker@example.test',
  MAIL_TO: 'one@example.test',
}
let g = graph({ vocab, storage: ram(vocab, options) })
let writes: Bundle[] = [], apply = g.apply
g.apply = async (...args) => {
  writes.push(...args[0])
  return await apply(...args)
}

test('reopening mail with the same recipient writes nothing', async () => {
  await g.apply([{
    entity: { eid: platform },
    email: { address: env.MAIL_TO },
  }], { trusted: true })
  writes.length = 0
  equal(await activate(g, env), { to: platform, from: env.MAIL_FROM })
  equal(writes, [])
})

test('changing a mail recipient updates delivery', async () => {
  writes.length = 0
  await activate(g, { ...env, MAIL_TO: 'two@example.test' })
  equal(writes.map((b) => b.email), [{ address: 'two@example.test' }])
})

test('a deploy that cannot send records its recipient and writes no letters', () => {
  equal(activation({ MAIL_TO: env.MAIL_TO }).to, undefined)
  equal(activation({}), {})
})

test('switching the tracker to Resend sends through Resend', async () => {
  let calls = 0
  let switched = {
    ...env,
    MAIL_VIA: 'resend',
    RESEND_TOKEN: 'sending-only',
    MAIL_FETCH: () => {
      calls++
      return Promise.resolve(Response.json({ id: 'provider-id' }))
    },
  }
  equal((await activate(g, switched)).to, platform)
  await sender(switched)!.send({
    from: env.MAIL_FROM,
    to: env.MAIL_TO,
    subject: 'A failure',
    text: 'The cause',
    html: '<p>The cause</p>',
  })
  equal(calls, 1)
})
