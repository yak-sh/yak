import { equal, test, throws } from '@yaks/testing'
import { derivedEid, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { loadVocab, pick } from '@yaks/vocab'
import { healDoc } from '../packages/heal/vocab.ts'
import { taskDoc } from '@yaks/task'
import { docDoc } from '@yaks/doc'
import { effectDoc } from '@yaks/effects/vocab'
import { moveBugs } from './migrate-heal-bugs.ts'

let vocab = loadVocab([
  pick(kernelDoc, [
    'entity',
    'created',
    'updated',
    'completed',
    'about',
  ]),
  pick(taskDoc, ['task', 'cancelled']),
  pick(docDoc, ['doc']),
  pick(healDoc, ['fixer']),
  pick(effectDoc, ['effect']),
  edgeDoc,
  {
    $defs: {
      bug: {
        component: true,
        properties: {
          fault: { type: 'string' },
          hits: { type: 'number' },
          last: { type: 'string' },
        },
      },
    },
  },
], [kernelKeywords, edgeKeywords])
let id = derivedEid
let tracker = [
  { eid: id('tracker-match'), fault: 'call:broken #@at run (#)', app: null },
  { eid: id('app-bug'), fault: 'entity:app only', app: 'app' },
  { eid: id('different-kind'), fault: ':other failure', app: null },
]

test('bug migration keeps task history, links exact box twins and is repeatable', async () => {
  let g = graph({ vocab, storage: ram(vocab), plugins: [edges(vocab)] })
  let done = { at: '2026-10-01T00:00:00Z' }
  await g.apply([
    {
      entity: { eid: id('matched') },
      task: {},
      doc: { title: 'Keep me', body: 'Evidence' },
      completed: done,
      bug: { fault: tracker[0].fault, hits: 3, last: done.at },
    },
    {
      entity: { eid: id('unmatched') },
      task: {},
      bug: { fault: 'entity:other failure' },
    },
    {
      entity: { eid: id('scoped') },
      task: {},
      bug: { fault: 'entity:app only' },
    },
    {
      entity: { eid: id('fixer') },
      fixer: { bug: id('matched') },
      doc: { title: 'Fixer history' },
    },
    { entity: { eid: id('old-fixer') }, fixer: { bug: id('unmatched') } },
    {
      entity: { eid: id('failed-run') },
      effect: { handler: 'exception_file', state: 'failed' },
    },
    {
      entity: { eid: id('other-run') },
      effect: { handler: 'other', state: 'failed' },
    },
    link(id('matched'), 'about', id('other-evidence')),
  ], { trusted: true })
  let before = await g.get([
    id('matched'),
    id('unmatched'),
    id('scoped'),
    id('fixer'),
    id('old-fixer'),
    id('failed-run'),
  ])
  let dry = await moveBugs(g, tracker, true)
  equal([dry.matched, dry.rewritten, dry.failedRunsDropped], [1, 1, 1])
  equal(await g.get(before.map((r) => r.entity.eid)), before)
  let moved = await moveBugs(g, tracker)
  equal([moved.bugs, moved.matched, moved.unmatchedOpen], [3, 1, 2])
  let [task, fixer, old] = await g.get([
    id('matched'),
    id('fixer'),
    id('old-fixer'),
  ])
  equal(task.doc, { title: 'Keep me', body: 'Evidence' })
  equal(task.completed, before[0].completed)
  equal([fixer.fixer, old.fixer], [{ bug: id('tracker-match') }, {
    bug: id('unmatched'),
  }])
  equal((await g.read('.about')).length, 2)
  equal((await g.read('.task')).length, 3)
  equal((await g.read('.effect')).length, 1)
  equal((await moveBugs(g, tracker)).patches, 0)
})

test('bug migration refuses ambiguous box groups and non-task sources before writing', async () => {
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([{
    entity: { eid: id('legacy') },
    bug: { fault: tracker[0].fault },
  }])
  await throws(
    () => moveBugs(g, [...tracker, { ...tracker[0], eid: id('duplicate') }]),
    /Duplicate box tracker fault/,
  )
  await throws(() => moveBugs(g, tracker), /Legacy bug is not a task/)
  equal((await g.read('.bug')).length, 1)
})

test('bug migration drops obsolete failed runs after the bug table retired', async () => {
  let vocab = loadVocab([
    pick(kernelDoc, ['entity', 'created', 'updated']),
    pick(healDoc, ['fixer']),
    pick(effectDoc, ['effect']),
  ], [kernelKeywords])
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([{
    entity: { eid: id('failed-run') },
    effect: { handler: 'exception_file', state: 'failed' },
  }], { trusted: true })
  equal((await moveBugs(g, tracker)).failedRunsDropped, 1)
  equal((await moveBugs(g, tracker)).patches, 0)
})
