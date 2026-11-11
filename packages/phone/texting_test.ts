import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { effects as registry } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { arrivalEid, consentEid, phoneDoc, type Sender, stash } from './mod.ts'
import { effects } from './effects.ts'
import { sending } from './send.ts'
import { lent, routes } from './plugin.ts'
import { runs } from './tools.ts'
import type { Heard, Provider } from './provider.ts'

let ana = '0b1c2d3e-0000-4000-8000-000000000001'
let ANA = '+12695550142'
let OURS = '+12695550100'

// A graph that keeps texts and sends them through `sender`.
let rig = (sender?: Sender) => {
  let vocab = loadVocab([docDoc, mailDoc, phoneDoc])
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs()] })
  fx.handle(sender ? { text_post: sending({ sender }) } : effects())
  return g
}
// One row, its components read as plain records.
let one = async (g: ReturnType<typeof rig>, eid: string) =>
  (await g.get([eid]))[0] as
    | Record<string, Record<string, unknown> | undefined>
    | undefined
let number = { entity: { eid: ana }, phone: { number: ANA } }
let agreed = {
  entity: { eid: consentEid(ana) },
  sms_consent: { person: ana, consent: 'Text me.', at: '2026-11-04T00:00:00Z' },
}
// Ana's number, and her agreement to be texted at it.
let person = [number, agreed]
let outbound = (eid: string): Bundle => ({
  entity: { eid },
  doc: { body: 'Your agenda is posted.' },
  text: {},
  deliver: { to: ana },
})

test('a text asking to go is sent to the number on its recipient and marked delivered', async () => {
  let texts = stash()
  let g = rig(texts)
  let eid = crypto.randomUUID()
  await g.apply([...person, outbound(eid)])
  let row = (await one(g, eid))!
  assertEquals(texts.sent, [{ to: ANA, text: 'Your agenda is posted.' }])
  assertEquals(row.text?.message_id, 'stash-1')
  assertEquals(!!row.delivered, true)
})

test('a text the carrier blocks is bounced with its reason and fails nothing', async () => {
  let g = rig(stash({ block: 'Not registered yet.' }))
  let eid = crypto.randomUUID()
  await g.apply([...person, outbound(eid)])
  assertEquals((await one(g, eid))?.bounced?.reason, 'Not registered yet.')
})

test('a failure that is not a carrier’s no is bounced in plain words, with the cause after them', async () => {
  let g = rig({
    send: () => Promise.reject(new Error('the sender fell over')),
  })
  let eid = crypto.randomUUID()
  try {
    await g.apply([...person, outbound(eid)])
  } catch { /* the sender's fault is thrown on, to the host's reporter */ }
  let reason = String((await one(g, eid))?.bounced?.reason)
  assertEquals(
    reason.startsWith(
      'This text could not be sent because of a fault on our side',
    ),
    true,
  )
  assertEquals(reason.endsWith('(the sender fell over)'), true)
})

test('a text to someone who has not agreed is bounced and never handed over', async () => {
  let texts = stash()
  let g = rig(texts)
  let eid = crypto.randomUUID()
  await g.apply([number, outbound(eid)])
  assertEquals(texts.sent, [])
  assertEquals(
    (await one(g, eid))?.bounced?.reason,
    `${ana} has not agreed to texts: no sms_consent is kept for them`,
  )
})

test("a host's texter is used by name, and the number it chose is kept", async () => {
  let sent: unknown[] = []
  let texter: Sender = {
    send: (t) => (sent.push(t), Promise.resolve({ id: 'h-1', from: OURS })),
  }
  let vocab = loadVocab([docDoc, mailDoc, phoneDoc])
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs()] })
  fx.handle(
    effects({ texters: { worker: texter } }, { sender: { via: 'worker' } }),
  )
  let eid = crypto.randomUUID()
  await g.apply([...person, outbound(eid)])
  assertEquals(sent, [{ to: ANA, text: 'Your agenda is posted.' }])
  assertEquals((await one(g, eid))?.text, {
    to: ANA,
    from: OURS,
    message_id: 'h-1',
  })
})

test('a text with no sender configured waits with the reason', async () => {
  let g = rig()
  let eid = crypto.randomUUID()
  await Promise.resolve(g.apply([...person, outbound(eid)])).catch(() => {})
  assertEquals(
    (await one(g, eid))?.deliver?.waiting,
    'waiting for a configured sender',
  )
})

// A provider given as data: a shared secret in a header signs its webhooks,
// and its events are already the shape @yaks/phone reads.
let SECRET = 'webhook-secret'
let acme = (sent: unknown[] = []): Provider => ({
  needs: ['key'],
  scheme: { header: 'acme-secret', token: true },
  heard: (event) => event as Heard,
  sender: (o) => ({
    send: (t) => (sent.push(t), Promise.resolve({ id: `${o.key}-1` })),
  }),
})
let posted = (event: Heard, secret = SECRET) =>
  new Request('https://box.example/acme/webhook', {
    method: 'POST',
    headers: { 'acme-secret': secret },
    body: JSON.stringify(event),
  })
let received = (id: string, text: string): Heard => ({
  arrival: {
    id,
    from: ANA,
    to: OURS,
    text,
    at: '2026-11-04T00:00:00Z',
    rcs: false,
    media: [],
  },
})

test("a provider's lent texter waits for what it needs, then sends as its name", async () => {
  let sent: unknown[] = []
  let options: { key?: string } = {}
  let texter = lent('acme', acme(sent), options)
  assertEquals(
    texter.waiting?.(),
    'waiting for credentials: a acme sender needs key',
  )
  options.key = 'k'
  assertEquals(texter.waiting?.(), undefined)
  assertEquals(await texter.send({ to: ANA, text: 'Hi' }), {
    id: 'k-1',
    via: 'acme',
  })
  assertEquals(sent, [{ to: ANA, text: 'Hi' }])
})

test('the door keeps a signed text, takes STOP as the end of consent and START as it again, and refuses an unsigned one', async () => {
  let g = rig(stash())
  await g.apply(person)
  let [door] = routes('acme', acme())({ graph: g }, { door: { key: SECRET } })
  let unsigned = await door.handle(posted(received('m0', 'hi'), 'wrong'))
  let hi = await door.handle(posted(received('m1', 'Post the agenda')))
  await door.handle(posted(received('m2', 'STOP')))
  assertEquals([unsigned.status, hi.status], [400, 200])
  assertEquals(await one(g, arrivalEid('m0', 'acme')), undefined)
  let kept = await one(g, arrivalEid('m1', 'acme'))
  assertEquals([kept?.doc?.body, kept?.text?.from], ['Post the agenda', ANA])
  assertEquals((await g.read('.sms_consent')).length, 0)
  await door.handle(posted(received('m3', 'start')))
  assertEquals(
    (await one(g, consentEid(ana)))?.sms_consent?.consent,
    'start',
  )
  assertEquals((await one(g, ana))?.phone, { number: ANA })
})

test('a door is served only where the options name one', () => {
  assertEquals(routes('acme', acme())({ graph: rig() }, {}), [])
})

// A call of `text_send`, its bundles applied.
let send = async (g: ReturnType<typeof rig>, args: Record<string, unknown>) =>
  await g.apply(
    await runs().text_send({ entity: { eid: 'c' }, call: { args } }, g),
  )

test('text_send texts someone who agreed, by id, number or name, and refuses anyone else', async () => {
  let texts = stash()
  let g = rig(texts)
  await g.apply(person)
  await send(g, { to: ana, body: 'Deployed.' })
  await send(g, { to: '(269) 555-0142', body: 'Live.' })
  await g.apply([{ entity: { eid: ana }, doc: { title: 'Ana' } }])
  await send(g, { to: 'Ana', body: 'Done.' })
  assertEquals(texts.sent.map((t) => t.text), ['Deployed.', 'Live.', 'Done.'])
  let refused = (args: Record<string, unknown>) =>
    send(g, args).then(() => '', (e: Error) => e.name)
  assertEquals(await refused({ to: '+12695550199', body: 'Hi' }), 'CallError')
  await g.apply([{ entity: { eid: consentEid(ana) }, sms_consent: null }])
  assertEquals(await refused({ to: ana, body: 'Hi' }), 'CallError')
  assertEquals(texts.sent.length, 3)
})

// A provider whose texts arrive by an unsigned callback, as voip.ms's do.
let called: Provider = {
  sender: () => ({ send: () => Promise.resolve({}) }),
  own: {
    fields: {},
    account: () => {
      throw new Error('no account here')
    },
    callback: 'id={ID}&from={FROM}&message={MESSAGE}',
    called: (q) =>
      q.get('id')
        ? {
          id: q.get('id')!,
          from: q.get('from')!,
          to: OURS,
          text: q.get('message') ?? '',
          at: '2026-11-04T00:00:00Z',
          rcs: false,
          media: [],
        }
        : null,
    said: { unopened: '', untexting: '' },
  },
}

test('a callback door keeps a text called with its key in the path, and refuses another key', async () => {
  let g = rig(stash())
  await g.apply(person)
  let [door] = routes('acme', called)({ graph: g }, { door: { key: 'k3y' } })
  let at = (key: string, id: string) =>
    door.handle(
      new Request(
        `https://box.example/acme/${key}?id=${id}&from=${
          encodeURIComponent(ANA)
        }&message=Tuesday`,
      ),
    )
  assertEquals([
    (await at('nope', 'm1')).status,
    (await at('k3y', 'm2')).status,
  ], [
    403,
    200,
  ])
  assertEquals(await one(g, arrivalEid('m1', 'acme')), undefined)
  assertEquals((await one(g, arrivalEid('m2', 'acme')))?.doc?.body, 'Tuesday')
})
