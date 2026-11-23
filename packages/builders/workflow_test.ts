import { equal, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { whole } from '@yaks/query'
import { toolEid } from '@yaks/tools'
import type { VocabDoc } from '@yaks/vocab'
import { effectDoc } from '@yaks/effects/vocab'
import { storage } from '@yaks/sqlite'
import { durable } from '../durable-object/testing.ts'
import { driver } from '../durable-object/sql.ts'
import { workshop } from './testing.ts'
import { derived } from './vocab.ts'
import { plugins } from './graph.ts'
import { reconcile } from './build.ts'
import { code } from './code.ts'
import { workflow } from './workflow.ts'

let step = (eid: string): Bundle => ({
  entity: { eid },
  builder: { query: `.${eid}` },
  doc: { title: eid },
})
let needs = (from: string, to: string): Bundle => ({
  entity: { eid: `${from}>${to}` },
  edge: { from, to },
  requires: {},
})
let stages = (rows: Bundle[]) =>
  workflow(rows).map((stage) => stage.map((s) => s.eid))

test('a workflow runs each step once every step it requires has', () => {
  // The video pipeline: voices and lines both wait on the script, and
  // assembling waits on both.
  assertEquals(
    stages([
      step('assemble'),
      step('lines'),
      step('voices'),
      step('script'),
      needs('voices', 'script'),
      needs('lines', 'script'),
      needs('lines', 'voices'),
      needs('assemble', 'lines'),
      needs('assemble', 'voices'),
    ]),
    [['script'], ['voices'], ['lines'], ['assemble']],
  )
  assertEquals(
    stages([
      step('a'),
      step('b'),
      step('c'),
      needs('b', 'a'),
      needs('c', 'a'),
    ]),
    [['a'], ['b', 'c']],
  )
})

test('every builder is drawn, a loop of requirements or a link to a non-builder included', () => {
  assertEquals(
    stages([step('a'), step('b'), needs('a', 'b'), needs('b', 'a')]),
    [['a', 'b']],
  )
  assertEquals(
    workflow([step('a'), needs('a', 'task')]),
    [[{ eid: 'a', title: 'a', requires: [] }]],
  )
})

// A person's step: one step asks them with a decision row among its outputs,
// and the next step's query matches that row once it carries their answer.
let asking: VocabDoc = {
  $defs: {
    decision: {
      component: true,
      type: 'object',
      properties: { question: { type: 'string' } },
    },
    decided: {
      component: true,
      type: 'object',
      properties: { choice: { type: 'string' } },
    },
  },
}

test("a person's step waits for their answer, and the next step builds on it", () => {
  let vocab = workshop([effectDoc, asking])
  let db = storage(driver(durable()), vocab, { derived: derived(vocab) })
  db.install()
  let ask = code({
    name: 'ask',
    description: 'Ask the person',
    answer: ({ binding }) => ({
      outputs: [{
        slot: 'ask',
        inputs: [binding.entities[0]],
        components: {
          decision: { question: `Send “${binding.vars.body}”?` },
        },
      }],
    }),
  })
  let send = code({
    name: 'send',
    description: 'Act on the answer',
    answer: ({ binding }) => ({
      outputs: [{
        slot: 'sent',
        inputs: [binding.entities[0]],
        components: { doc: { body: binding.vars.choice } },
      }],
    }),
  })
  let here = { vocab, tools: [ask, send] }
  let g = graph({ storage: db, vocab, plugins: plugins(null, here) })
  let builders: Bundle[] = [
    {
      entity: { eid: 'asks' },
      builder: {
        query: '.doc.title=Letter, doc.body=$body',
        to: toolEid('ask'),
        immediate: true,
      },
    },
    {
      entity: { eid: 'sends' },
      builder: {
        query: '.built.slot=ask, built.current=true, decided.choice=$choice',
        to: toolEid('send'),
        immediate: true,
      },
    },
  ]
  g.apply(builders)
  for (let b of g.get(['asks', 'sends']) as Bundle[]) {
    let plan = db.tx((tx) => reconcile(tx, b, here)) as { writes: Bundle[] }
    g.apply(plan.writes, { trusted: true })
  }
  let read = (q: string) => g.read(whole(`${q}&*`)) as Bundle[]
  let sent = () => read('.built.slot=sent').map((b) => (b.doc as Comp).body)
  g.apply([{ entity: { eid: 'letter' }, doc: { title: 'Letter', body: 'hi' } }])
  let [question] = read('.decision')
  equal([(question.decision as Comp).question, sent()], ['Send “hi”?', []])
  g.apply([{ entity: question.entity, decided: { choice: 'Send it' } }])
  equal(sent(), ['Send it'])
})
