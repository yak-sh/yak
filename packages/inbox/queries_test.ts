import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { attention, type Row, threads } from './mod.ts'
import {
  boundedReads,
  candidates,
  dependents,
  discussion,
  requirements,
  threadRoots,
  words,
} from './queries.ts'

let at = (n: number) => `2026-10-02T12:00:0${n}.000Z`
let rows = (bundles: Bundle[]): Row[] =>
  bundles.map((b) => ({ eid: b.entity.eid, comps: b as Row['comps'] }))
test('candidate reads include replies, archived roots and open dependents; repeated archive stamps anew', async () => {
  let vocab = loadVocab([kernelDoc, docDoc, taskDoc, projectDoc, edgeDoc], [
    edgeKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab), plugins: [kernel()] })
  let has = (path: string) => {
    let [name, prop] = path.split('.')
    return path == 'entity.eid' ||
      (!!vocab.comp(name) && (!prop || vocab.props(name).includes(prop)))
  }
  await g.apply([
    { entity: { eid: 'person' }, doc: { title: 'Person' } },
    { entity: { eid: 'thread' }, task: {}, doc: { title: 'Thread' } },
    {
      entity: { eid: 'decision' },
      task: {},
      filed: { assignee: 'person' },
      decision: {
        question: 'Ship?',
        choices: [{ label: 'Yes', description: 'Ship' }, {
          label: 'No',
          description: 'Wait',
        }],
        recommended: 'Yes',
      },
    },
    { entity: { eid: 'worker' }, task: {} },
    {
      entity: { eid: 'edge' },
      edge: { from: 'worker', to: 'decision' },
      requires: {},
    },
  ], { now: at(1) })
  await g.apply([{
    entity: { eid: 'mine' },
    comment: { target: 'thread' },
    doc: { body: 'SQLite?' },
    $actor: { by: 'person' },
  }], { now: at(2) })
  let who = { actor: 'person', operator: true }
  let read = async (q: string) => q ? rows(await g.read(q)) : []
  let inbox = async () => {
    let first = await read(candidates(who, has))
    let chat = await read(discussion(first, has))
    let edges = await read(requirements([...first, ...chat], has))
    let tasks = await read(dependents(edges, has))
    return threads([...first, ...chat, ...edges, ...tasks], who)
  }
  assertEquals((await inbox()).map((t) => [t.eid, t.lane, t.blocking]), [[
    'decision',
    'Needs you',
    true,
  ], ['thread', 'Recent', false]])
  await g.apply(attention('thread', 'archived'), { now: at(3) })
  assertEquals((await inbox()).map((t) => t.eid), ['decision'])
  await g.apply([{
    entity: { eid: 'reply' },
    comment: { target: 'thread', reply_to: 'mine' },
    doc: { body: 'Yes' },
  }], { now: at(4) })
  assertEquals((await inbox()).find((t) => t.eid == 'thread')?.lane, 'Replies')
  await g.apply(attention('thread', 'archived'), { now: at(5) })
  assertEquals((await inbox()).map((t) => t.eid), ['decision'])
  assertEquals((await g.get(['thread']))[0].archived, { at: at(5) })
  await g.apply([{ entity: { eid: 'worker' }, completed: {} }], { now: at(6) })
  assertEquals(
    (await inbox()).find((t) => t.eid == 'decision')?.blocking,
    false,
  )
})

test('sparse delivery vocabularies retain archived candidates without querying missing properties', async () => {
  let component = (properties: Record<string, { type: string }>) => ({
    component: true,
    type: 'object',
    properties,
  })
  let text = { type: 'string' }
  let vocab = loadVocab([{
    $defs: {
      entity: component({ eid: text }),
      comment: component({ target: text }),
      opened: component({ at: text }),
      archived: component({ at: text }),
    },
  }])
  let store = ram(vocab)
  await store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'new' }, comment: { target: 'owner' } },
      {
        entity: { eid: 'read' },
        comment: { target: 'owner' },
        opened: { at: 'today' },
      },
      {
        entity: { eid: 'archived' },
        comment: { target: 'owner' },
        archived: { at: 'today' },
      },
      { entity: { eid: 'other' }, comment: { target: 'other' } },
    ])
  )
  let who = {
    actor: 'owner',
    operator: true,
    addrs: new Set(['owner@example.com']),
  }
  assertEquals(
    store.rows(candidates(who, words(vocab))).map((r) => r.eid).sort(),
    ['archived', 'new', 'read'],
  )
})

test('bounded inbox reads preserve every discussion member within the socket budget', () => {
  let input = Array.from({ length: 2200 }, (_, i) => ({
    eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    comps: { task: {} },
  }))
  let reads = boundedReads(input, (part) => discussion(part))
  assertEquals(reads.length > 1, true)
  let members = new Set<string>()
  for (let line of reads) {
    assertEquals(
      new TextEncoder().encode(JSON.stringify(line)).length <= 48 * 1024,
      true,
    )
    for (let row of input) if (line.includes(row.eid)) members.add(row.eid)
  }
  assertEquals(members.size, input.length)
  assertEquals(boundedReads([], (part) => discussion(part)), [])
})

test('default discussion excludes internal transcript work without changing attention', async () => {
  let v = loadVocab({
    $defs: Object.fromEntries([
      ['entry', { session: { type: 'string' }, seq: { type: 'number' } }],
      ['created', { by: { type: 'string' }, at: { type: 'string' } }],
      ['content', { body: { type: 'string' } }],
      ['session', { actor: { type: 'string' } }],
      ...[
        'output',
        'reasoning',
        'prompt',
        'notice',
        'result',
        'ask',
        'call',
        'exception',
        'refusal',
        'stop',
      ].map((name) => [name, {}]),
    ].map((
      [name, properties],
    ) => [name, { component: true, type: 'object', properties }])),
  })
  let g = graph({ vocab: v, storage: ram(v) })
  let data: Bundle[] = [
    {
      entity: { eid: 'root' },
      session: { actor: 'person' },
      created: { by: 'person', at: at(1) },
    },
    ...[
      'input',
      'answer',
      'thinking',
      'tool',
      'prompt',
      'notice',
      'attempt',
      'failure',
      'stop',
    ].map((id, seq) => ({
      entity: { eid: id },
      entry: { session: 'root', seq },
      created: { by: id == 'input' ? 'person' : 'agent', at: at(seq + 1) },
      content: { body: id },
      ...id == 'answer'
        ? { output: {} }
        : id == 'thinking'
        ? { output: {}, reasoning: {} }
        : id == 'tool'
        ? { call: {} }
        : id == 'attempt'
        ? { ask: {} }
        : id == 'failure'
        ? { exception: {} }
        : id == 'input'
        ? {}
        : { [id]: {} },
    })),
  ]
  await g.apply(data)
  let seed = rows([data[0]])
  let full = rows(
    await g.read(discussion(seed, words(v), { text: 'thinking' })),
  )
  let narrow = rows(await g.read(discussion(seed, words(v))))
  assertEquals(narrow.map((r) => r.eid).sort(), [
    'answer',
    'failure',
    'input',
    'root',
    'stop',
  ])
  let policy = (rs: Row[]) =>
    threads(rs, { actor: 'person' }).map((t) => ({
      eid: t.eid,
      lane: t.lane,
      at: t.at,
      unread: t.unread,
      latest: t.latest.eid,
      messages: t.messages.map((m) => m.eid),
    }))
  assertEquals(policy(narrow), policy(full))
  assertEquals(full.some((r) => r.eid == 'thinking'), true)
  assertEquals(
    rows(await g.read(discussion(seed, words(v), { direction: 'received' })))
      .length,
    full.length,
  )
})

test('derived read inputs name each thread once before query budget splitting', () => {
  let root: Row = { eid: 'session', comps: { session: {} } }
  let all: Row[] = Array.from(
    { length: 2500 },
    (_, i) => ({ eid: `entry${i}`, comps: { entry: { session: 'session' } } }),
  )
  assertEquals(threadRoots([...all, root]), [root])
  assertEquals(
    boundedReads(threadRoots([...all, root]), (p) => discussion(p)).length,
    1,
  )
})

test('a removed root changes only its identity bucket, not every bounded read', () => {
  let all: Row[] = Array.from({ length: 1000 }, (_, i) => ({
    eid: `root${String(i).padStart(4, '0')}`,
    comps: { task: {} },
  }))
  let plan = (input: Row[]) => boundedReads(input, (part) => discussion(part))
  let before = plan(all)
  let after = plan(all.slice(1))
  assertEquals(before.length > 1, true)
  assertEquals(after.filter((line) => !before.includes(line)).length, 1)
  assertEquals(before.filter((line) => !after.includes(line)).length, 1)
  assertEquals(plan(all.toReversed()), before)
})
