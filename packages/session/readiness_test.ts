// Multi-part tool requests owe work when their final required part lands.
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effectDoc, effects } from '@yaks/effects'
import { equal, test } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from './comp.ts'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, effectDoc])
for (
  let names of [
    ['tool_async', 'call', 'entry'],
    ['entry', 'tool_async', 'call'],
    ['call', 'entry', 'tool_async'],
  ]
) {
  let fx = effects(vocab, { owes: 'declared' })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  await g.apply([{ entity: { eid: 'session' }, session: {} }])
  let parts: Record<string, object> = {
    tool_async: {},
    call: {},
    entry: { session: 'session', seq: 1 },
  }
  let counts: number[] = []
  for (let name of names) {
    await g.apply([{ entity: { eid: 'call' }, [name]: parts[name] }])
    counts.push((await g.read('.effect.handler=session_tool')).length)
  }
  test(`tool readiness persists once when ${names.join(', ')} are written`, () => {
    equal(counts, [0, 0, 1])
  })
}
