// A runner lent `wear` says each transcript's persona at the top of every ask,
// its base read from where bases are kept, and what the host adds after it,
// and offers it the tools that persona contains, all read again each ask (this
// provider names no cache expiry, so none is held), so an edit reaches a
// transcript on its next turn.
import { equal, test } from '@yaks/testing'
import { link } from '@yaks/edge'
import type { Request } from '@yaks/model'
import { toolEid } from '@yaks/tools/result'
import { agent, begin } from './agent.ts'
import { harness } from './testing.ts'

let h = await harness()
let bases = await harness()
let persona = (eid: string, body: string, base?: string) => ({
  entity: { eid },
  persona: base ? { base } : {},
  doc: { title: eid, body },
})
await bases.g.apply([persona('platform', 'Every space hears this.')])
await h.g.apply([
  persona('space', 'The space says this.', 'platform'),
  { entity: { eid: 'name' }, doc: { title: 'name', body: 'You are Elihu.' } },
  link('space', 'contains', 'name'),
])
let asked: Request[] = []
let a = agent({
  h,
  name: 'fake',
  model: (req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: 'fake',
      items: [{ kind: 'assistant', text: 'ok' }],
    })
  },
  wear: { bases: bases.g.storage },
  instructions: () => Promise.resolve('Where it is: two apps.'),
})
let session = await begin(h.g, 'hello', {
  persona: 'space',
  using: { model: a.model },
})
await a.idle(session)
let first = asked.at(-1)!.instructions
await bases.g.apply([persona('platform', 'Every space hears this now.')])
await a.send(session, 'again')
await a.idle(session)
let second = asked.at(-1)!.instructions

await a.close()

// A host that says topics and offers tools too: a session opened on a topic,
// a helper it started, a session wearing its project's common persona, one
// wearing nothing whose first line chose its own instructions, and one whose
// persona contains tools, the runner's own and the host's others.
let t = await harness()
let tool = (name: string) => ({
  name,
  description: name,
  parameters: {},
  run: () => name,
})
let registered = (name: string) => ({
  entity: { eid: toolEid(name) },
  tool: { name },
})
await t.g.apply([
  persona('tender', 'Tend your topic.'),
  persona('head', 'Attend to your topic.'),
  persona('kit', 'What every head carries.'),
  ...['read', 'task_new', 'search', 'spend_show'].map(registered),
  link('head', 'contains', toolEid('task_new')),
  link('head', 'contains', 'kit'),
  link('kit', 'contains', toolEid('read')),
  {
    entity: { eid: 'yaks' },
    topic: { name: 'yaks' },
    doc: { title: 'Yaks', body: 'What belongs under yaks.' },
    content: { body: 'A yak is a bovid.' },
  },
  { entity: { eid: 'holdco' }, project: {} },
  { entity: { eid: 'venture' }, project: {}, filed: { project: 'holdco' } },
  {
    ...persona('all', 'Every venture hears this.'),
    persona: { home: 'holdco' },
  },
  {
    ...persona('ours', 'This venture says this.'),
    persona: { home: 'venture' },
  },
  link('holdco', 'contains', 'all'),
  link('venture', 'contains', 'ours'),
], { trusted: true })
let topical = agent({
  h: t,
  name: 'fake',
  model: (req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: 'fake',
      items: [{ kind: 'assistant', text: 'ok' }],
    })
  },
  tools: [tool('shell'), tool('read')],
  named: () => ['task_new', 'search', 'spend_show'].map(tool),
  wear: { topic: true, tools: true },
})
let told = async (o: Parameters<typeof begin>[2], parent?: string) => {
  let s = await begin(t.g, undefined, o)
  if (parent) {
    await t.g.apply([{ entity: { eid: s }, spawned: { parent } }], {
      trusted: true,
    })
  }
  await topical.send(s, 'hello')
  await topical.idle(s)
  return {
    s,
    text: asked.at(-1)!.instructions,
    tools: asked.at(-1)!.tools?.map((t) => t.name),
  }
}
let using = { model: topical.model }
let oracle = await told({ persona: 'tender', topic: 'yaks', using })
let helper = await told({ using }, oracle.s)
await t.g.apply([{
  entity: { eid: 'yaks' },
  content: { body: 'A yak grunts.' },
}])
await topical.send(oracle.s, 'again')
await topical.idle(oracle.s)
let later = asked.at(-1)!.instructions
let common = await told({ persona: 'ours', project: 'venture', using })
let chosen = await t.g.apply([
  { entity: { eid: '$s' }, session: { id: 'chosen' }, native: {} },
  {
    entity: { eid: '$said' },
    entry: { session: '$s' },
    content: { body: 'hello' },
    using,
    sending: { instructions: 'Answer with JSON.' },
  },
])
await topical.idle(chosen[0].entity.eid)
let contract = asked.at(-1)!.instructions
let names = () => asked.at(-1)!.tools?.map((t) => t.name)
let head = await told({ persona: 'head', using })
let offered = names()
let helped = (await told({ using }, head.s), names())
await t.g.apply([link('head', 'contains', toolEid('spend_show'))])
await topical.send(head.s, 'again')
await topical.idle(head.s)
let gained = names()
let [selected] = await t.g.apply([
  { entity: { eid: '$s' }, session: { persona: 'head' }, native: {} },
  {
    entity: { eid: '$said' },
    entry: { session: '$s' },
    content: { body: 'hello' },
    using,
    sending: { tools: ['search'] },
  },
])
await topical.idle(selected.entity.eid)
let kept = names()
await topical.close()

// The lines with words in them: each heading and body, without the rules.
let heads = (text?: string) =>
  String(text).split('\n').filter((l) => /\w/.test(l))

test('an ask says the base, the persona, what it contains, then what the host adds', () => {
  equal(heads(first), [
    '# #platform platform',
    'Every space hears this.',
    '# #space space',
    'The space says this.',
    '# #name name',
    'You are Elihu.',
    'Where it is: two apps.',
  ])
})

test("a change to the base reaches the transcript's next ask", () => {
  equal(heads(second)[1], 'Every space hears this now.')
})

test('a session opened on a topic is told its persona, then the topic compiled as it reads now', () => {
  equal(heads(oracle.text).slice(0, 2), [
    '# #tender tender',
    'Tend your topic.',
  ])
  equal(String(oracle.text).includes('A yak is a bovid.'), true)
  equal(String(later).includes('A yak grunts.'), true)
  equal(String(later).includes('A yak is a bovid.'), false)
})

test('a helper is told what the session that started it is', () => {
  equal(helper.text, oracle.text)
})

test("a session wearing its project's common persona hears each one above it", () => {
  equal(heads(common.text), [
    '# #ours ours',
    'This venture says this.',
    '# #all all',
    'Every venture hears this.',
  ])
})

test('a session wearing nothing keeps the instructions its first line chose', () => {
  equal(contract, 'Answer with JSON.')
})

test('a session is offered exactly the tools its persona and the personas it contains contain', () => {
  equal(offered, ['task_new', 'read'])
  equal(helped, offered)
})

test("a tool its persona gains is offered at the transcript's next ask", () => {
  equal(gained, ['task_new', 'spend_show', 'read'])
})

test('a persona containing no tool leaves the runner its own', () => {
  equal(oracle.tools?.slice(0, 2), ['shell', 'read'])
})

test('a line that selected its own tools keeps them', () => {
  equal(kept, ['search'])
})
