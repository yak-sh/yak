// A letter that reaches a project waits on its board as a task until a reply
// goes out, the way a bug's task waits until the bug is fixed.

import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { effects as registry } from '@yaks/effects'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc, docs } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { mailDoc } from './comp.ts'
import { mailbox } from './plugin.ts'
import { stash } from './stash.ts'
import { effects } from './effects.ts'
import { taskEid } from './work.ts'

let pick = (doc: VocabDoc, ...names: string[]): VocabDoc => ({
  $defs: Object.fromEntries(names.map((name) => [name, doc.$defs![name]])),
})
let vocab = loadVocab([
  pick(kernelDoc, 'entity', 'completed', 'about'),
  edgeDoc,
  pick(docDoc, 'doc'),
  pick(taskDoc, 'task', 'cancelled'),
  pick(projectDoc, 'project', 'filed'),
  mailDoc,
], [kernelKeywords, edgeKeywords])

// A box: the platform's project, its address filed under it, a project that
// wears its own address, and a person who writes in. Assembly and seed data
// are the fixture, outside each timed behavior; the tests keep apart by their
// own letters.
let box = async () => {
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  fx.handle(effects({ vocab }, { sender: { via: 'stash' } }))
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [
      fx,
      docs(),
      mailbox({ domain: 'books.example', sender: stash(), effects: fx }),
    ],
  })
  await g.apply([
    { entity: { eid: 'platform' }, project: {} },
    {
      entity: { eid: 'hello' },
      email: { address: 'hello@books.example' },
      filed: { project: 'platform' },
    },
    {
      entity: { eid: 'venture' },
      project: {},
      email: { address: 'venture@books.example' },
    },
    { entity: { eid: 'ana' }, email: { address: 'ana@else.example' } },
  ], { trusted: true })
  return g
}
let arrive = (eid: string, target: string): Bundle => ({
  entity: { eid },
  doc: { title: 'feedback: the page is blank', body: 'Nothing loads.' },
  mail: { from: 'ana@else.example', target },
})
let g = await box()
let get = async (eid: string) => (await g.get([eid]))[0] as Bundle | undefined
let comp = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

// What arrives, and the one reply that goes out, written once; each test
// reads what the effects made of it.
await g.apply([
  arrive('a1', 'hello'),
  arrive('b1', 'venture'),
  arrive('c1', 'ana'),
  { ...arrive('c2', 'hello'), deliver: { to: 'ana' } },
  arrive('d1', 'hello'),
  arrive('e1', 'hello'),
], { trusted: true })
await g.apply([{
  entity: { eid: 'd2' },
  doc: { title: 'Re: feedback', body: 'Fixed.' },
  mail: { from: 'hello@books.example', reply_to: 'd1' },
  deliver: { to: 'ana' },
}, {
  entity: { eid: 'e2' },
  doc: { title: 'About your feedback', body: 'Fixed.' },
  mail: { from: 'hello@books.example', target: 'e1' },
  deliver: { to: 'ana' },
}], { trusted: true })

test('a letter to an address filed under a project files a task there', async () => {
  let task = await get(taskEid('a1'))
  equal(comp(task, 'filed').project, 'platform')
  equal(
    comp(task, 'doc').title,
    'Letter from ana@else.example: feedback: the page is blank',
  )
  equal(!!(await get(edgeEid(taskEid('a1'), 'about', 'a1')))?.about, true)
  equal(!!task?.completed, false)
})

test('a letter to a project wearing its own address files a task there', async () => {
  equal(comp(await get(taskEid('b1')), 'filed').project, 'venture')
})

test('a letter reaching no project, or one going out, files nothing', async () => {
  equal(await get(taskEid('c1')), undefined)
  equal(await get(taskEid('c2')), undefined)
})

test('a delivered reply, or a letter sent about it, completes its task', async () => {
  equal(!!(await get(taskEid('d1')))?.completed, true)
  equal(!!(await get(taskEid('e1')))?.completed, true)
})
