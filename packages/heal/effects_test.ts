import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import type { Context } from '@yaks/tracker/report'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import type { Event } from '@yaks/effects'
import { toolsDoc } from '@yaks/tools/vocab'
import { processDoc } from '@yaks/process'
import { effects } from './effects.ts'
import { healDoc } from './vocab.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let n = 0

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
      call: { to: 'tool' },
      created: { by: S, via: R },
      entry: { session: S },
      execution: { by: R },
    }, {
      entity: { eid: 'tool' },
      tool: { name: 'broken' },
    }])
  )
  await report({
    entity: { eid: 'tool-failure' },
    exception: { message: 'missing field' },
    output: { source: 'call' },
  })
  assertEquals(told.length, 1)
  assertEquals(told[0].context.tags, { tool: 'broken' })
  assertEquals(told[0].context.actor, { by: S, via: R })
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
