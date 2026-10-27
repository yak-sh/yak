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
import { currentStatus, react } from './react.ts'
import { toolEid } from '@yaks/tools'
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
// steps answered as they go, a checkpoint leaving the model its last `kept`
// lines, and no `sending` or stop anywhere, so a lookup for one finds none.
let lines = (session: string, n: number, kept = 30): Bundle[] => {
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
    checkpoint: { through: `${session}.${seq - kept}`, seq: seq - kept },
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
    ...lines('tools', 60),
    ...lines('turn', 2000, 1900),
  ])
)

// A step's reads, status and turn, and the VM steps they took.
let read = async (session: string) => {
  let before = steps()
  let status = await currentStatus(g, session)
  await reach(g, session, { turn: true })
  return { status, steps: steps() - before }
}

// A step's reads after the step before it appended its ask, its call and the
// call's result; and the first reading, which nothing was remembered for.
let step = async (session: string) => {
  let whole = (await read(session)).steps
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
  return { ...await read(session), whole }
}
let short = await step('short'), long = await step('long')

// A transcript a step read, that 2,000 lines then landed on at once (an
// import, a run another process wrote), read again.
let landed = async () => {
  let all = lines('landed', 2000)
  await s.tx((tx) => tx.patch(all.slice(0, 61)))
  await read('landed')
  await s.tx((tx) => tx.patch(all.slice(61)))
  return (await read('landed')).steps
}
let bulk = await landed()

// A step running the call the newest ask made, after a step before it read the
// transcript, and the VM steps it took.
let echo = {
  name: 'echo',
  description: 'say it',
  parameters: { type: 'object', properties: {} },
  run: () => 'ok',
}
let tool = async (session: string) => {
  await read(session)
  let [last] = await g.rows(
    `.entry.session=${session}&.order=-entry.seq&.limit=1&.fields=entity.eid`,
  )
  let [ask] = await g.apply([{
    entity: { eid: `${session}.tool-ask` },
    entry: { session },
    ask: { to: M, through: String(last['entity.eid']) },
    using: { model: M },
  }])
  await g.apply([{
    entity: { eid: `${session}.tool-call` },
    entry: { session },
    call: { to: toolEid('echo'), id: 'tool', args: {}, source: ask.entity.eid },
    tool_async: {},
  }])
  let before = steps()
  let step = await react(g, session, {
    model: () => Promise.reject(new Error('a tool step asks no model')),
    tools: [echo],
    runCall: `${session}.tool-call`,
  })
  return { did: step.did, steps: steps() - before }
}
let shortTool = await tool('tools'), longTool = await tool('turn')

test('a step on a long transcript reads what one on a short transcript does', () => {
  ok(short.status == 'pending' && long.status == 'pending')
  ok(
    long.steps < short.steps * 1.5,
    `${long.steps} steps on 2,000 lines, ${short.steps} on 60`,
  )
})

test('a tool step of a long turn reads what one of a short turn does, not the window the turn sent', () => {
  ok(shortTool.did == 'ran' && longTool.did == 'ran')
  ok(
    longTool.steps < shortTool.steps * 1.5,
    `${longTool.steps} steps behind a 1,900-line window, ${shortTool.steps} on 60 lines`,
  )
})

test('a reading after thousands of lines landed costs what reading them all does', () => {
  ok(
    bulk < long.whole * 1.25,
    `${bulk} steps after 2,000 lines landed, ${long.whole} reading 2,000 whole`,
  )
})
