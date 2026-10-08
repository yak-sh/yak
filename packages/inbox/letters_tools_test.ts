// The inbox's list and archive tools over letters: what is addressed to you,
// what archiving hides, and how @yaks/mail's marks on a letter read here.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Actor, type Bundle, type Comp, graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { mailbox, mailDoc } from '@yaks/mail'
import { runs as mail } from '@yaks/mail/tools'
import { runs as inbox } from './tools.ts'
import { inboxDoc } from './vocab.ts'

let call = mint()
let tools = { ...mail(undefined, { domain: 'books.example' }), ...inbox() }

let ask = (
  g: ReturnType<typeof graph>,
  tool: string,
  args: Record<string, unknown> = {},
  actor: Actor | null = null,
): Promise<Bundle[]> =>
  Promise.resolve(tools[tool]({
    entity: { eid: call },
    call: { args },
    ...(actor ? { created: actor } : {}),
  }, g)) as Promise<Bundle[]>

let did = async (
  g: ReturnType<typeof graph>,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Bundle[]> => await g.apply(await ask(g, tool, args))

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let ids = (answer: Bundle[]): string[] => answer.map((b) => b.entity.eid)

// A club with an address book: Ana reads the club's mail at its own desk.
let club = async () => {
  let vocab = loadVocab([kernelDoc, docDoc, mailDoc, inboxDoc, {
    $defs: {
      content: {
        component: true,
        type: 'object',
        properties: { body: { type: 'string' } },
      },
      output: {
        component: true,
        type: 'object',
        properties: {
          source: { type: 'string', ref: 'entity', death: 'keep' },
        },
      },
    },
  }], [kernelKeywords])
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [kernel(), mailbox({ domain: 'books.example' })],
  })
  await g.apply([
    { entity: { eid: 'ana' }, doc: { title: 'Ana' } },
    {
      entity: { eid: 'desk' },
      email: { address: 'hello@books.example' },
    },
  ])
  return { g }
}

// One letter that arrived: a Message-ID is what makes it one.
let arrival = (eid: string, o: Record<string, unknown> = {}) => ({
  entity: { eid },
  doc: { title: 'Potluck Friday', body: 'Bring a dish.' },
  mail: {
    from: 'stranger@elsewhere.example',
    to: 'hello@books.example',
    at: '2026-09-01T10:00:00.000Z',
    message_id: `${eid}@elsewhere.example`,
    target: 'desk',
    ...o,
  },
})

test('the inbox is what is addressed to you and not archived', async () => {
  let { g } = await club()
  await g.apply([
    arrival('a1'),
    // Written to Ana here rather than routed to the desk.
    {
      entity: { eid: 'a2' },
      doc: { title: 'You are in' },
      mail: { from: 'hello@books.example' },
      deliver: { to: 'ana' },
    },
    // Somebody else's letter entirely.
    {
      entity: { eid: 'a3' },
      doc: { title: 'Not yours' },
      mail: { from: 'x@y.example', to: 'someone@elsewhere.example' },
    },
  ])
  assertEquals(
    ids(await ask(g, 'inbox_list', { who: 'desk', lane: 'Replies' })),
    ['a1'],
  )
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'ana' })), ['a2'])
  assertEquals(
    ids(await ask(g, 'inbox_list', { who: 'desk', lane: 'Recent' })),
    ['a2'],
  )
  let search = { who: 'desk', search: 'you are in' }
  assertEquals(
    ids(await ask(g, 'inbox_list', { ...search, direction: 'said' })),
    ['a2'],
  )
  assertEquals(
    ids(await ask(g, 'inbox_list', { ...search, direction: 'received' })),
    [],
  )
  // Whoever is asking, where the line names nobody.
  assertEquals(
    ids(await ask(g, 'inbox_list', { lane: 'Replies' }, { by: 'desk' })),
    ['a1'],
  )
  await assertRejects(() => ask(g, 'inbox_list'), Error, 'nobody is asking')
})

test('inbox list searches complete received words while default results are summaries', async () => {
  let { g } = await club()
  let body = 'ordinary words '.repeat(1024) + 'needle-in-full-body'
  await g.apply([{
    ...arrival('long-letter'),
    doc: { title: 'Long letter', body },
  }])
  let [summary] = await ask(g, 'inbox_list', { who: 'desk' })
  let [letter] = await g.get(['long-letter'], [])
  assertEquals(summary.entity.num, letter.entity.num)
  assertEquals(comp(summary, 'doc').title, 'Long letter')
  assertEquals(comp(summary, 'doc').body, undefined)
  let search = { who: 'desk', search: 'needle-in-full-body' }
  assertEquals(ids(await ask(g, 'inbox_list', search)), ['long-letter'])
  assertEquals(
    ids(await ask(g, 'inbox_list', { ...search, direction: 'received' })),
    ['long-letter'],
  )
  assertEquals(
    ids(await ask(g, 'inbox_list', { ...search, direction: 'said' })),
    [],
  )
})

test('an address you wear puts a letter in your inbox', async () => {
  let { g } = await club()
  // Ana wears the address the letter was delivered to, and nothing routed it.
  await g.apply([
    { entity: { eid: 'ana' }, email: { address: 'ana@books.example' } },
    {
      entity: { eid: 'a1' },
      doc: { title: 'For Ana' },
      mail: { from: 'x@y.example', to: 'ANA@Books.Example', message_id: 'm1' },
    },
  ])
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'ana' })), ['a1'])
})

test('archiving is the one act that hides, and --all is the way back', async () => {
  let { g } = await club()
  await g.apply([arrival('a1')])
  await did(g, 'inbox_archive', { item: 'a1' })
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'desk' })), [])
  assertEquals(
    ids(await ask(g, 'inbox_list', { who: 'desk', all: true })),
    ['a1'],
  )
})

test('mail reads and archives act on the shared root and refresh after a reply', async () => {
  let { g } = await club()
  let owner = { by: 'desk' }
  let stamp = (minute: number) => `2026-10-02T12:0${minute}:00.000Z`
  await g.apply([arrival('root')], { now: stamp(0) })
  await g.apply([arrival('reply', { reply_to: 'root' })], { now: stamp(1) })
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'desk' })), ['root'])
  await g.apply(await ask(g, 'mail_show', { letter: 'reply' }, owner), {
    now: stamp(2),
  })
  let [root] = await g.get(['root'])
  assertEquals(comp(root, 'opened').at, stamp(2))
  await g.apply(await ask(g, 'inbox_archive', { item: 'reply' }, owner), {
    now: stamp(3),
  })
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'desk' })), [])
  await g.apply([arrival('fresh', { reply_to: 'reply' })], { now: stamp(4) })
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'desk' })), ['root'])
  await g.apply(await ask(g, 'mail_show', { letter: 'fresh' }, owner), {
    now: stamp(5),
  })
  ;[root] = await g.get(['root'])
  assertEquals(comp(root, 'opened').at, stamp(5))
  await g.apply(
    await ask(g, 'mail_reply', {
      letter: 'fresh',
      body: 'Thanks',
    }, owner),
    { now: stamp(6) },
  )
  assertEquals(ids(await ask(g, 'inbox_list', { who: 'desk' })), [])
  ;[root] = await g.get(['root'])
  assertEquals(comp(root, 'archived').at, stamp(6))
})
