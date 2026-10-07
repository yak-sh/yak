// Only values passed to a builder are inputs; adopting their fingerprint keeps
// existing attempts and outputs without asking the tool again.
import { equal, test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolEid } from '@yaks/tools'
import { plugins } from './graph.ts'
import { workshop } from './testing.ts'
import { build } from './tools.ts'

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
