// A step reads what was appended since the last, not the transcript's length:
// on a transcript of thousands of lines it costs what it costs on a short one.
import { type Bundle, graph, identityEid } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { ok, test } from '@yaks/testing'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { effectDoc } from '@yaks/effects'
import { stepping } from '../sqlite/testing.ts'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { reach } from './reach.ts'
import { currentStatus } from './react.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab(
  [sessionDoc, toolsDoc, modelDoc, effectDoc, kernelDoc, archetypeDoc],
  [kernelKeywords],
)
let { driver, steps } = stepping()
let s = storage(driver, vocab, { derived: sessionDerived(vocab) })
s.install()
let g = graph({ storage: s, vocab, plugins: [sessions()] })
let M = identityEid('model', ['fake'])

// A native transcript of `n` lines, as the box holds them: background tool
// steps answered as they go, a checkpoint leaving the model its last lines,
// and no `sending` or stop anywhere, so a lookup for one finds none.
let lines = (session: string, n: number): Bundle[] => {
  let out: Bundle[] = [{ entity: { eid: session }, session: {} }]
  let line = (seq: number, parts: Record<string, unknown>) =>
    out.push({
      entity: { eid: `${session}.${seq}` },
      entry: { session, seq },
      ...parts,
    })
  line(1, { content: { body: 'go' }, using: { model: M } })
  let seq = 1
  while (seq < n - 3) {
    let ask = `${session}.${seq + 1}`, call = `${session}.${seq + 2}`
    line(++seq, {
      ask: { to: M, through: `${session}.${seq - 1}` },
      using: { model: M },
    })
    line(++seq, { call: { id: call, source: ask }, tool_async: {} })
    line(++seq, { result: { call }, content: { body: 'ok' } })
  }
  line(++seq, {
    checkpoint: { through: `${session}.${seq - 30}`, seq: seq - 30 },
    notice: {},
    content: { body: 'summary' },
  })
  return out
}
await s.tx((tx) =>
  tx.patch([
    { entity: { eid: M }, model: { name: 'fake' } },
    ...lines('short', 60),
    ...lines('long', 2000),
  ])
)

// A step's reads, status and turn, after the step before it appended its
// ask, its call and the call's result.
let step = async (session: string) => {
  let read = async () => {
    let status = await currentStatus(g, session)
    await reach(g, session, { turn: true })
    return status
  }
  await read()
  let [last] = await g.rows(
    `.entry.session=${session}&.order=-entry.seq&.limit=1&.fields=entity.eid`,
  )
  let [ask] = await g.apply([{
    entity: { eid: `${session}.ask` },
    entry: { session },
    ask: { to: M, through: String(last['entity.eid']) },
    using: { model: M },
  }])
  await g.apply([{
    entity: { eid: `${session}.call` },
    entry: { session },
    call: { id: 'last', source: ask.entity.eid },
    tool_async: {},
  }])
  await g.apply([{
    entity: { eid: `${session}.result` },
    entry: { session },
    result: { call: `${session}.call` },
    content: { body: 'ok' },
  }])
  let before = steps()
  let status = await read()
  return { status, steps: steps() - before }
}
let short = await step('short'), long = await step('long')

test('a step on a long transcript reads what one on a short transcript does', () => {
  ok(short.status == 'pending' && long.status == 'pending')
  ok(
    long.steps < short.steps * 1.5,
    `${long.steps} steps on 2,000 lines, ${short.steps} on 60`,
  )
})
