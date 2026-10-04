// Every tool reference takes an id or a name through the same input boundary.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { graph, type NamedTool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { kernelDoc } from '@yaks/kernel'
import { CallError, resolved } from './args.ts'

let named = async (count: number) => {
  let vocab = loadVocab([kernelDoc, docDoc, {
    $defs: { person: { component: true, properties: {} } },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([
    ...Array.from({ length: count }, (_, i) => ({
      entity: { eid: `person-${i + 1}` },
      person: {},
      doc: { title: 'Ada' },
    })),
    { entity: { eid: 'other' }, doc: { title: 'Ada' } },
  ])
  let tool: NamedTool = {
    name: 'person_read',
    description: 'Read a person by id or name',
    readOnly: true,
    inputSchema: { properties: { who: { type: 'string', ref: 'person' } } },
    run: () => [],
  }
  return (who: string | string[], readOnly = true) =>
    resolved({ ...tool, readOnly }, { who }, g)
}

for (
  let [outcome, count, refusal] of [
    ['one match', 1, ''],
    ['none', 0, 'Ada names no person'],
    ['several', 2, 'person-1'],
  ] as const
) {
  test(`tool name resolution: ${outcome}`, async () => {
    let ask = await named(count)
    for (let readOnly of [true, false]) {
      for (let who of ['Ada', ['Ada']]) {
        if (!refusal) {
          equal(await ask(who, readOnly), {
            who: Array.isArray(who) ? ['person-1'] : 'person-1',
          })
        } else {
          let error = await assertRejects(
            () => ask(who, readOnly),
            CallError,
            refusal,
          )
          if (count > 1) {
            equal(error.message.includes('person-2'), true)
            equal(error.message.includes('other'), false)
          }
        }
      }
    }
  })
}
