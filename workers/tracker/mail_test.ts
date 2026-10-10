// Reopening configured mail preserves activation and writes only changed addresses.
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { options, platform, vocab } from './core.ts'
import { activate } from './mail.ts'

let env = {
  MAIL: {},
  MAIL_FROM: 'tracker@example.test',
  MAIL_TO: 'one@example.test',
}
let since = '2026-10-01T00:00:00.000Z'
let g = graph({ vocab, storage: ram(vocab, options) })
await g.apply([{
  entity: { eid: platform },
  email: { address: env.MAIL_TO },
}], { trusted: true })
let writes: Bundle[] = [], apply = g.apply
g.apply = async (...args) => {
  writes.push(...args[0])
  return await apply(...args)
}
let saved = new Map([['mail-since', since]])
let metaWrites = 0
let keeping = () => ({
  get: (key: string) => saved.get(key),
  set: (key: string, value: string) => {
    metaWrites++
    saved.set(key, value)
  },
})

test('reopening mail with the same recipient and activation writes nothing', async () => {
  // The fixture can also be reused by the budget runner's second pass.
  await g.apply([{
    entity: { eid: platform },
    email: { address: env.MAIL_TO },
  }], { trusted: true })
  writes.length = 0
  metaWrites = 0
  equal(await activate(g, platform, env, keeping, () => 0), {
    to: platform,
    from: env.MAIL_FROM,
    since,
  })
  equal(writes, [])
  equal(metaWrites, 0)
})

test('changing a mail recipient updates delivery without resetting activation', async () => {
  writes.length = 0
  metaWrites = 0
  await activate(
    g,
    platform,
    { ...env, MAIL_TO: 'two@example.test' },
    keeping,
    () => 0,
  )
  equal(writes.map((b) => b.email), [{ address: 'two@example.test' }])
  equal(saved.get('mail-since'), since)
  equal(metaWrites, 0)
})
