import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  type Bundle,
  type Comp,
  type Graph,
  graph,
  identityEid,
} from '@yaks/graph'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import type { Context } from '@yaks/tracker/report'
import { effectsIn, loadVocab } from '@yaks/vocab'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { nameKeywords } from '@yaks/names'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { effects as registry, type Event } from '@yaks/effects'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { processDoc } from '@yaks/process'
import { bugDoc } from '@yaks/tracker/vocab'
import { effects, type Options } from './effects.ts'
import { healDoc } from './vocab.ts'

let P = identityEid('provider', ['codex'])
let M = identityEid('model', ['sol'])

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// Every word a task and fixer request touch. No @yaks/spawn handlers: a fixer
// is the request written, never a process started.
let vocab = loadVocab(
  [
    kernelDoc,
    idDoc,
    edgeDoc,
    docDoc,
    taskDoc,
    projectDoc,
    sessionDoc,
    toolsDoc,
    modelDoc,
    processDoc,
    bugDoc,
    healDoc,
  ],
  [kernelKeywords, idKeywords, nameKeywords, edgeKeywords],
)

let host = async (options: Options = {}) => {
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [ids(vocab), fx],
  })
  fx.handle(effects({ graph: g }, {
    provider: 'codex',
    model: 'sol',
    project: 'home',
    cap: 2,
    ...options,
  }))
  await g.apply([
    { entity: { eid: P }, provider: { name: 'codex' } },
    { entity: { eid: M }, model: { name: 'sol' } },
    { entity: { eid: 'home' }, project: {} },
    { entity: { eid: 'venture' }, project: {} },
    { entity: { eid: 'work' }, task: {}, filed: { project: 'venture' } },
    { entity: { eid: 'run' }, session: {} },
    { entity: { eid: 'work' }, claim: { session: 'run' } },
  ], { trusted: true })
  return g
}

let n = 0
// Fixer tests start from tasks that another path has filed.
let file = async (g: Graph, message: string, project = 'home') => {
  let eid = `bug${++n}`
  await g.apply([{
    entity: { eid },
    doc: { title: message },
    task: {},
    filed: { project, priority: 1 },
    bug: { fault: message, hits: 1 },
  }], { trusted: true })
  return eid
}

let bugs = async (g: Graph) => await g.read('.bug&*')
let fixers = async (g: Graph) => await g.read('.fixer&*')

// Reporting needs no tracker vocabulary or sink in the box graph.
let reportVocab = loadVocab([kernelDoc, toolsDoc, processDoc, healDoc, {
  $defs: {
    session: { component: true, kind: true, properties: {} },
    entry: {
      component: true,
      kind: true,
      properties: {
        session: { type: 'string', ref: 'session', death: 'keep' },
      },
    },
  },
}], [kernelKeywords])
let reporting = () => {
  let told: { error: Error; context: Partial<Context> }[] = []
  let storage = ram(reportVocab)
  let g = graph({
    vocab: reportVocab,
    storage,
  })
  let handlers = effects({
    graph: g,
    report: (error, context = {}) => {
      told.push({ error: error as Error, context })
    },
  })
  let run = (event: Event) =>
    handlers.exception_report(
      event,
      g.outside,
      (rows) => g.apply(rows, { trusted: true }),
    )
  let report = async (row: Bundle) => {
    await storage.tx((tx) => tx.patch([row]))
    let event: Event = {
      kind: 'created',
      entity: row.entity,
      name: 'exception',
      comp: comp(row, 'exception'),
    }
    await run(event)
    return event
  }
  return { storage, told, report, run }
}

let S = 'a3f19c02-4b00-4000-8000-000000000001'
let R = 'a3f19c02-4b00-4000-8000-000000000002'

test('a created actionable exception reports its entity and occurrence once', async () => {
  let { report, told } = reporting()
  await report({
    entity: { eid: 'broken' },
    session: {},
    exception: { message: 'missing field' },
  })
  assertEquals(told.length, 1)
  assertEquals(told[0].error.message, 'missing field')
  assertEquals(told[0].context.eid, identityEid('exception_report', ['broken']))
  assertEquals(told[0].context.during, {
    entity: 'broken',
    kind: 'session',
    session: 'broken',
  })
})

test('the exception effect preserves stored exception details', async () => {
  let { report, told } = reporting()
  let row = {
    entity: { eid: 'details' },
    entry: { session: S },
    exception: {
      type: 'TypeError',
      value: 'missing field',
      stack: 'TypeError: missing field\n    at run (/run.ts:1:2)',
      at: '2026-10-10T00:00:00Z',
      version: 7,
    },
  }
  await report(row)
  assertEquals(told.length, 1)
  assertEquals(told[0].error.name, 'TypeError')
  assertEquals(told[0].error.message, 'missing field')
  assertEquals(told[0].error.stack, row.exception.stack)
  assertEquals(told[0].context, {
    eid: identityEid('exception_report', ['details']),
    at: row.exception.at,
    version: row.exception.version,
    during: { entity: 'details', kind: 'entry', session: S },
  })
})

test('transient exceptions and empty messages do not report', async () => {
  let { report, told } = reporting()
  for (let message of ['fetch timed out', 'responses: HTTP 503', ' ']) {
    await report({ entity: { eid: `failure${++n}` }, exception: { message } })
  }
  assertEquals(told, [])
})

test('a replayed exception effect reports the same occurrence', async () => {
  let { report, run, told } = reporting()
  let row = {
    entity: { eid: 'broken' },
    session: {},
    exception: {},
    content: { body: 'no such table' },
  }
  let event = await report(row)
  await run(event)
  assertEquals(told.length, 2)
  assertEquals(told.map(({ context }) => context.eid), [
    identityEid('exception_report', ['broken']),
    identityEid('exception_report', ['broken']),
  ])
  assertEquals(told[0].context.during, {
    entity: 'broken',
    kind: 'session',
    session: 'broken',
  })
  assertEquals(told[0].error.stack, undefined)
})

test('a tool exception keeps its call session and process', async () => {
  let { report, storage, told } = reporting()
  await storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'call' },
      entry: { session: S },
      execution: { by: R },
    }])
  )
  await report({
    entity: { eid: 'tool-failure' },
    exception: { message: 'missing field' },
    output: { source: 'call' },
  })
  assertEquals(told.length, 1)
  assertEquals(
    told[0].context.eid,
    identityEid('exception_report', ['tool-failure']),
  )
  assertEquals(told[0].context.during, {
    entity: 'tool-failure',
    kind: 'entity',
    session: S,
    process: R,
  })
})

test('a process exception names its process', async () => {
  let { report, told } = reporting()
  await report({
    entity: { eid: 'process-failure' },
    process: {},
    exception: { message: 'missing field' },
  })
  assertEquals(told.length, 1)
  assertEquals(told[0].context.during, {
    entity: 'process-failure',
    kind: 'process',
    process: 'process-failure',
  })
})

test('a new bug starts one fixer holding it', async () => {
  let g = await host({ effort: 'high' })
  await file(g, 'exit 127: codex not found')
  let [bug] = await bugs(g)
  let [fixer, ...more] = await fixers(g)
  assertEquals(more.length, 0)
  assertEquals(comp(fixer, 'fixer')?.bug, bug.entity.eid)
  assert(fixer.session)
  assertEquals(comp(fixer, 'session')?.operator, false)
  assertEquals(comp(bug, 'claim')?.session, fixer.entity.eid)
  let [ask] = await g.read(`.entry.session=${fixer.entity.eid}&*`)
  assertEquals(comp(ask, 'using'), {
    provider: P,
    model: M,
    effort: 'high',
  })
  assert(String(comp(ask, 'content')?.body).includes('codex not found'))
})

test('off: no provider files and starts nothing', async () => {
  let g = await host({ provider: undefined })
  await file(g, 'boom')
  assertEquals((await bugs(g)).length, 1)
  assertEquals((await fixers(g)).length, 0)
})

test('muted: nofix on the project, or on home for all', async () => {
  for (let muted of ['venture', 'home']) {
    let g = await host()
    await g.apply([{ entity: { eid: muted }, nofix: {} }], { trusted: true })
    await file(g, 'x', 'venture')
    assertEquals((await bugs(g)).length, 1)
    assertEquals((await fixers(g)).length, 0, muted)
  }
})

test('at cap: the bug waits', async () => {
  let g = await host({ cap: 1 })
  await file(g, 'first')
  await file(g, 'second')
  assertEquals((await bugs(g)).length, 2)
  assertEquals((await fixers(g)).length, 1)
})

test('cooling down: a fault fixed a moment ago starts no second fixer', async () => {
  let g = await host()
  await file(g, 'flaky write')
  let [bug] = await bugs(g)
  await g.apply([{ entity: bug.entity, completed: {}, claim: null }], {
    trusted: true,
  })
  await file(g, 'flaky write')
  assertEquals((await bugs(g)).length, 2)
  assertEquals((await fixers(g)).length, 1)
  // With no cooldown the new bug gets its own.
  let quick = await host({ cooldown: 0 })
  await file(quick, 'flaky write')
  let [done] = await bugs(quick)
  await quick.apply([{ entity: done.entity, completed: {}, claim: null }], {
    trusted: true,
  })
  await file(quick, 'flaky write')
  assertEquals((await fixers(quick)).length, 2)
})

test('the boot sweep finds the open bugs nobody holds', async () => {
  let g = await host({ provider: undefined })
  await file(g, 'one')
  await file(g, 'two')
  let [a] = await bugs(g)
  await g.apply([{ entity: a.entity, completed: {} }], { trusted: true })
  let [fix] = effectsIn([healDoc]).filter((e) => e.sweep)
  let pending = await g.read(fix.sweep!)
  assertEquals(pending.length, 1)
  assert(pending[0].entity.eid != a.entity.eid)
})
