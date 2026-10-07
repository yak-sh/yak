// Only values passed to a builder are inputs; adopting their fingerprint keeps
// existing attempts and outputs without asking the tool again.
import { equal, test } from '@yaks/testing'
import { type Binding, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolEid } from '@yaks/tools'
import { plugins } from './graph.ts'
import { workshop } from './testing.ts'
import { build } from './tools.ts'
import { inputKey } from './key.ts'

test('unread bound-entity changes preserve an attempt, including fingerprint cutover', async () => {
  let vocab = workshop()
  let g = graph({ storage: ram(vocab), vocab, plugins: plugins() })
  await g.apply([
    { entity: { eid: toolEid('code') }, tool: { name: 'code' } },
    { entity: { eid: 'source' }, doc: { title: 'Source', body: 'a turtle' } },
    {
      entity: { eid: 'builder' },
      builder: {
        query: '$s .doc.title=Source, doc.body=$description',
        to: toolEid('code'),
        immediate: true,
      },
      content: { body: 'Design $description for $s' },
    },
  ])
  let [run] = await build(g, vocab, { builder: 'builder' }, null)
  let [before] = await g.get([run])
  let attempt = before.build as Comp
  // An existing build from the whole-entity fingerprint implementation.
  await g.apply([{
    entity: { eid: run },
    build: { inputs: 'old-whole-entity-hash' },
  }], { trusted: true })
  await g.apply([{
    entity: { eid: 'source' },
    project: { name: 'position changed' },
    doc: { title: 'Source' },
  }])
  await build(g, vocab, { builder: 'builder' }, null)
  let [kept] = await g.get([run])
  equal((kept.build as Comp).key, attempt.key)
  equal((kept.build as Comp).call, attempt.call)
  equal((await g.read('.call')).length, 1)
  await g.apply([{ entity: { eid: 'source' }, doc: { body: 'a sheep' } }])
  equal((await g.read('.call')).length, 2)
})

test('legacy frozen bracket arrays have the same fingerprint as self-described collections', () => {
  let member = { entities: ['point'], vars: { title: 'A turtle' } }
  let modern: Binding = {
    entities: ['subject'],
    vars: { subject: 'subject' },
    collections: [{
      vars: ['title'],
      entityVars: ['point'],
      members: [{
        ...member,
        collections: [{ vars: [], entityVars: [], members: [] }],
      }],
    }],
  }
  let legacy = {
    entities: ['subject'],
    vars: { subject: 'subject' },
    collections: [[{ ...member, collections: [[]] }]],
  } as unknown as Binding
  equal(inputKey(legacy), inputKey(modern))
  equal(
    inputKey({ ...legacy, collections: [] }),
    inputKey({ ...modern, collections: [] }),
  )
})

test('reconciliation adopts an old frozen bracket call without generating another take', async () => {
  let vocab = workshop()
  let g = graph({ storage: ram(vocab), vocab, plugins: plugins() })
  await g.apply([
    { entity: { eid: toolEid('code') }, tool: { name: 'code' } },
    { entity: { eid: 'source' }, doc: { title: 'Source' } },
    { entity: { eid: 'point' }, project: { name: 'A turtle' } },
    {
      entity: { eid: 'builder' },
      builder: {
        query: '$s .doc.title=Source; [$p .project, project.name=$title]',
        to: toolEid('code'),
        immediate: true,
      },
      content: { body: 'Build $p for $s' },
    },
  ])
  let [run] = await build(g, vocab, { builder: 'builder' }, null)
  let [before] = await g.get([run])
  let attempt = before.build as Comp
  let [call] = await g.get([String(attempt.call)])
  let args = (call.call as Comp).args as Comp
  let old = (binding: Binding): unknown => ({
    ...binding,
    collections: binding.collections?.map((group) => group.members.map(old)),
  })
  await g.apply([
    { entity: { eid: run }, build: { inputs: 'legacy-whole-entity-hash' } },
    {
      entity: call.entity,
      call: { args: { ...args, binding: old(args.binding as Binding) } },
    },
    { entity: { eid: 'point' }, doc: { body: 'Unread gameplay write' } },
  ], { trusted: true })
  await build(g, vocab, { builder: 'builder' }, null)
  let [kept] = await g.get([run])
  equal((kept.build as Comp).key, attempt.key)
  equal((kept.build as Comp).call, attempt.call)
  equal((kept.build as Comp).inputs, attempt.inputs)
  equal((await g.read('.call')).length, 1)
})
