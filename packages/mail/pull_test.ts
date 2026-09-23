import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { hookDoc, hookEid } from '@yaks/hook'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { mailDoc } from './comp.ts'
import { mailbox } from './plugin.ts'
import {
  type Edge,
  edge,
  type EdgeMessage,
  type EdgeRequest,
  messageIdOf,
  pull,
  received,
} from './pull.ts'
import { service } from './service.ts'

let domain = 'books.example'
let ana = 'p-ana'

let extra: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    about: { component: true, type: 'object', edge: 'about', properties: {} },
  },
}

// A graph that knows Ana, with or without the hook vocabulary.
let club = async (hooks = true) => {
  let vocab = loadVocab(
    [docDoc, mailDoc, edgeDoc, extra, ...(hooks ? [hookDoc] : [])],
    [edgeKeywords],
  )
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [docs(), mailbox({ domain })],
  })
  await g.apply([{
    entity: { eid: ana },
    person: { name: 'Ana' },
    email: { address: `ana@${domain}` },
  }])
  return g
}

// An edge over fixtures. `forget` makes it hand back what was acknowledged,
// the way it would after a crash between recording and acknowledging.
let stub = (
  messages: EdgeMessage[],
  requests: EdgeRequest[] | null = [],
  { forget = false, broken = false } = {},
) => {
  let acked: string[] = []
  let fresh = <T extends { id: string }>(xs: T[]) =>
    forget ? xs : xs.filter((x) => !acked.includes(x.id))
  let at: Edge = {
    messages: () =>
      broken
        ? Promise.reject(new Error('down'))
        : Promise.resolve(fresh(messages)),
    notified: (ids) => (acked.push(...ids), Promise.resolve()),
    requests: () => Promise.resolve(requests && fresh(requests)),
    processed: (ids) => (acked.push(...ids), Promise.resolve()),
  }
  return { at, acked }
}

let letter = (n: number, to = `ana@${domain}`): EdgeMessage => ({
  id: `msg:178986153020${n}:<m${n}@far.example>`,
  from: 'bounces@relay.example',
  from_header: 'Bo <bo@far.example>',
  to,
  subject: `hello ${n}`,
  text: 'soup?',
  verified: true,
  received_at: '2026-09-23T12:00:00.000Z',
})

let hit = (n: number): EdgeRequest => ({
  id: `r${n}`,
  source: 'posthog',
  method: 'POST',
  path: '/hook/ana/posthog',
  body: '{"type":"issue"}',
  sig_ok: 1,
})

let mails = async (g: Awaited<ReturnType<typeof club>>) =>
  (await g.read('.mail')).map((b: Bundle) => b.mail as Comp)

Deno.test('messageIdOf: the Message-ID inside the edge key', () => {
  assertEquals(messageIdOf('msg:1789:<a1@x.example>'), 'a1@x.example')
  assertEquals(messageIdOf('a1@x.example'), 'a1@x.example')
})

Deno.test('received: the edge fields become the headers arrive reads', () => {
  let [m, arrival] = received({ ...letter(1), in_reply_to: '<a0@x.example>' })
  assertEquals(
    ['from', 'subject', 'message-id', 'in-reply-to'].map(m.headers.get),
    ['Bo <bo@far.example>', 'hello 1', 'm1@far.example', '<a0@x.example>'],
  )
  assertEquals(arrival, {
    at: '2026-09-23T12:00:00.000Z',
    text: 'soup?',
    verified: true,
  })
})

Deno.test('pull: letters are recorded, routed and acknowledged', async () => {
  let g = await club()
  let { at, acked } = stub([letter(1), letter(2, 'nobody@far.example')])
  assertEquals(await pull({ graph: g, domain }, at), {
    messages: 2,
    requests: 0,
  })
  assertEquals(acked, [letter(1).id, letter(2).id])
  let [one, two] = await mails(g)
  assertEquals(
    [one.message_id, one.from, one.target, one.verified],
    ['m1@far.example', 'bo@far.example', ana, true],
  )
  assertEquals(two.target, undefined)
})

Deno.test('pull: a letter handed back after a crash is recorded once', async () => {
  let g = await club()
  let { at, acked } = stub([letter(1)], [hit(1)], { forget: true })
  await pull({ graph: g, domain }, at)
  await pull({ graph: g, domain }, at)
  assertEquals((await mails(g)).length, 1)
  assertEquals((await g.read('.hook')).length, 1)
  assertEquals(acked, [letter(1).id, 'r1', letter(1).id, 'r1'])
})

Deno.test('pull: a request becomes a hook about the mailbox it names', async () => {
  let g = await club()
  let { at } = stub([], [hit(1)])
  assertEquals(await pull({ graph: g, domain }, at), {
    messages: 0,
    requests: 1,
  })
  let eid = hookEid({ id: 'r1', source: 'posthog' })
  let [hook] = await g.read(`.hook`)
  assertEquals(hook.entity.eid, eid)
  assertEquals(
    [(hook.hook as Comp).event, (hook.hook as Comp).verified],
    ['issue', true],
  )
  assertEquals((await g.read('.about')).map((b) => b.entity.eid), [
    edgeEid(eid, 'about', ana),
  ])
})

Deno.test('pull: each tray fails alone, and a graph without hook leaves requests', async () => {
  let g = await club()
  let { at } = stub([letter(1)], [hit(1)], { broken: true })
  assertEquals(await pull({ graph: g, domain }, at), {
    messages: 0,
    requests: 1,
  })
  let bare = await club(false)
  let other = stub([letter(1)], [hit(1)])
  assertEquals(await pull({ graph: bare, domain }, other.at), {
    messages: 1,
    requests: 0,
  })
  assertEquals(other.acked, [letter(1).id])
})

Deno.test('edge: the HTTP API, a missing tray, and acknowledgements in bites', async () => {
  let asked: string[] = []
  let at = edge({ url: 'https://inbox.example/', token: 't' }, (url, init) => {
    asked.push(`${init.method} ${url} ${init.body ?? ''}`.trim())
    return Promise.resolve(
      url.includes('/requests?')
        ? new Response('nope', { status: 404 })
        : new Response(url.includes('/messages?') ? '[]' : ''),
    )
  })
  assertEquals(await at.messages(), [])
  assertEquals(await at.requests(), null)
  await at.notified(Array.from({ length: 51 }, (_, i) => `m${i}`))
  assertEquals(asked.map((a) => a.slice(0, 50)), [
    'GET https://inbox.example/messages?unnotified=1&.d',
    'GET https://inbox.example/requests?unprocessed=1&l',
    'POST https://inbox.example/messages/notified {"ids',
    'POST https://inbox.example/messages/notified {"ids',
  ])
})

Deno.test('service: a config naming no pull has nothing to take', async () => {
  assertEquals(await service({ graph: await club() }, { domain }), undefined)
})
