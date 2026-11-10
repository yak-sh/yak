// A task's watchers hear it change: the session that filed it, sessions that
// mention it, and actors subscribed to it, each once, through a knock its bus
// says (./listen.ts `hear`), committed and run as `session_watch` is.

import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects } from '@yaks/effects'
import { human, idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { taskDoc } from '@yaks/task'
import { toolEid } from '@yaks/tools'
import { toolsDoc } from '@yaks/tools/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { processDoc } from '@yaks/process/vocab'
import { equal, test } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { statusComputed } from './state.ts'
import { running } from './run.ts'
import { hear } from './listen.ts'
import { mentions, watch } from './watch.ts'

let vocab = loadVocab([
  kernelDoc,
  idDoc,
  provenanceDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  taskDoc,
  sessionDoc,
  toolsDoc,
  personaDoc,
  projectDoc,
  processDoc,
], [kernelKeywords, idKeywords])

let JEFF = { by: 'jeff', via: 'web' }

// A session wearing the project's persona.
let agent = (id: string, more = {}) => ({
  entity: { eid: id },
  session: { id, persona: 'taskmaster', ...more },
})

// A project, the persona its agents wear, Jeff, and three agent sessions: the
// operator Jeff opened, a worker, and one whose harness ended it. `T-7` was
// filed by `filer` and is assigned to Jeff.
let office = async (filer = 'worker') => {
  let fx = effects(vocab)
  let g = graph({
    storage: ram(vocab, { computed: statusComputed, number: true }),
    vocab,
    plugins: [ids(vocab), fx],
  })
  let { session_watch } = running(g, {
    holder: 'w',
    model: () => Promise.reject(new Error('no turn is taken here')),
    tools: [],
  })
  fx.handle({ session_watch })
  await g.apply([
    { entity: { eid: 'p' }, project: {} },
    {
      entity: { eid: 'taskmaster' },
      persona: { home: 'p' },
      doc: { title: 'TaskMaster' },
    },
    { entity: { eid: 'jeff' }, person: {}, doc: { title: 'Jeff' } },
    { entity: { eid: 'web' } },
    agent('operator', { operator: true }),
    agent('worker'),
    agent('gone', { ended: true }),
  ], { trusted: true })
  await g.apply([{
    entity: { eid: 't' },
    task: {},
    doc: { title: 'Give the Worker a token', body: 'steps' },
    $actor: { by: 'taskmaster', via: filer },
  }], { trusted: true })
  let write = async (bundles: Bundle[], actor = JEFF) => {
    await g.apply(bundles.map((b) => ({ ...b, $actor: actor })), {
      trusted: true,
    })
    await fx.idle()
  }
  // What a session hears, marked said: a knock's words, or what else it is
  // told.
  let heard = async (session: string) => {
    let lines: string[] = []
    await hear(g, null, session, (line) => lines.push(line))
    return lines.map((line) =>
      line.startsWith('knock ')
        ? line.slice(line.indexOf(': ') + 2)
        : line.split(' ')[0]
    )
  }
  // The same, as the whole lines.
  let lines = async (session: string) => {
    let lines: string[] = []
    await hear(g, null, session, (line) => lines.push(line))
    return lines
  }
  let [task] = await g.get(['t'])
  return { g, write, heard, lines, id: human(vocab)(task) }
}

let done = [{ entity: { eid: 't' }, completed: {} }]
let TITLE = 'Give the Worker a token'

test('Jeff completing a task an agent filed knocks that session once', async () => {
  let o = await office()
  await o.write(done)
  equal(await o.heard('worker'), [`${o.id} completed by Jeff: ${TITLE}`])
  await watch(o.g, 't')
  equal(await o.heard('worker'), [])
  equal(await o.heard('operator'), [])
})

test('a session is not knocked about its own write', async () => {
  let o = await office()
  await o.write(done, { by: 'taskmaster', via: 'worker' })
  equal(await o.heard('worker'), [])
})

test("a filer that is over is told through its project's operator", async () => {
  let o = await office('gone')
  await o.write(done)
  equal(await o.heard('operator'), [`${o.id} completed by Jeff: ${TITLE}`])
})

test('a session whose own words mention the task hears it; one that only read it does not', async () => {
  let o = await office()
  await o.g.apply([
    agent('talker'),
    agent('reader'),
    {
      entity: { eid: 'said' },
      entry: { session: 'talker', seq: 1 },
      output: {},
      content: { body: `${o.id} still waits on Jeff` },
    },
    {
      entity: { eid: 'read' },
      entry: { session: 'reader', seq: 1 },
      result: {},
      content: { body: `[{"id": "${o.id}"}]` },
    },
  ], { trusted: true })
  await o.write(done)
  equal((await o.heard('talker')).length, 1)
  equal(await o.heard('reader'), [])
})

test('an answered decision knocks once, with the choice', async () => {
  let o = await office()
  await o.write([{
    entity: { eid: 't' },
    decision: {
      question: 'Which?',
      choices: [
        { label: 'Yes', description: 'do it' },
        { label: 'No', description: 'do not' },
      ],
      recommended: 'Yes',
    },
  }], { by: 'taskmaster', via: 'worker' })
  await o.write([{ entity: { eid: 't' }, decided: { choice: 'Yes' } }])
  equal(await o.heard('worker'), [
    `${o.id} answered "Yes" by Jeff: ${TITLE}`,
  ])
})

test("an agent's comment knocks the filer; a person's reaches it as a comment", async () => {
  let o = await office()
  await o.write([{
    entity: { eid: 'c1' },
    comment: { target: 't' },
    doc: { body: 'landed 1234abc' },
  }], { by: 'taskmaster', via: 'operator' })
  let [c1] = await o.g.get(['c1'])
  equal(await o.heard('worker'), [
    `${human(vocab)(c1)} on ${o.id} by TaskMaster: landed 1234abc`,
  ])
  await o.write([{
    entity: { eid: 'c2' },
    comment: { target: 't' },
    doc: { body: 'thanks' },
  }])
  equal(await o.heard('worker'), ['comment'])
})

let comment = (eid: string, body: string, more = {}): Bundle[] => [{
  entity: { eid },
  comment: { target: 't' },
  doc: { body },
  ...more,
}]

test("a comment's knock carries the comment whole", async () => {
  let o = await office()
  let body = `Landed 1234abc. ${'It works. '.repeat(40)}`.trim()
  await o.write(comment('c1', body), { by: 'taskmaster', via: 'operator' })
  let [line] = await o.heard('worker')
  equal(line.endsWith(`by TaskMaster: ${body}`), true)
})

test("a subagent's comment knocks no session up its line", async () => {
  let o = await office()
  await o.g.apply([
    { entity: { eid: 'file' }, transcript: {} },
    {
      entity: { eid: 'fork' },
      session: { id: 'fork', transcript: 'file' },
      spawned: { parent: 'worker' },
    },
    {
      entity: { eid: 's1' },
      subscription: { actor: 'operator', target: 't', mode: 'watch' },
    },
  ], { trusted: true })
  await o.write(comment('c1', 'landed 1234abc'), {
    by: 'taskmaster',
    via: 'fork',
  })
  equal(await o.heard('worker'), [])
  equal((await o.heard('operator')).length, 1)
})

let SPAWN = toolEid('session_spawn')

// A managed run the worker started on `t`, still at work: its spawn call
// names the task as the worker typed it, and completing the task lets its
// claim go.
let started = async () => {
  let o = await office()
  await o.g.apply([
    { entity: { eid: SPAWN }, tool: { name: 'session_spawn' } },
  ], { trusted: true })
  await o.g.apply([
    {
      entity: { eid: 'spawn-call' },
      call: { to: SPAWN, args: { task: o.id } },
      $actor: { by: 'taskmaster', via: 'worker' },
    },
    {
      entity: { eid: 'run' },
      session: { id: 'run', persona: 'taskmaster', source: 'spawn-call' },
      spawned: { parent: 'worker' },
      process: { pid: 42 },
    },
    {
      entity: { eid: 's1' },
      subscription: { actor: 'operator', target: 't', mode: 'watch' },
    },
  ], { trusted: true })
  return { ...o, run: { by: 'taskmaster', via: 'run' } }
}

test("a run's completion and its receipt are one knock, the report whole", async () => {
  let o = await started()
  await o.write(done, o.run)
  equal(await o.heard('worker'), [])
  equal((await o.heard('operator')).length, 1)
  let report = `Landed 1234abc. ${'It works. '.repeat(40)}`.trim()
  await o.write(
    comment('receipt', report, { knock: { target: 'worker' } }),
    o.run,
  )
  let [line, ...more] = await o.lines('worker')
  equal(more, [])
  equal(line.split(' ').slice(2, 5), ['on', o.id, '(done)'])
  equal(line.startsWith('knock ') && line.endsWith(report), true)
  equal((await o.heard('operator')).length, 1)
})

test('a run completing a task its receipt is not about knocks for it', async () => {
  let o = await started()
  await o.g.apply([{
    entity: { eid: 'other' },
    task: {},
    doc: { title: 'Another' },
    $actor: { by: 'taskmaster', via: 'worker' },
  }], { trusted: true })
  await o.write([{ entity: { eid: 'other' }, completed: {} }], o.run)
  equal((await o.heard('worker')).length, 1)
})

test("a sub-project's watcher that is over is told through the operator above it", async () => {
  let o = await office()
  await o.g.apply([
    { entity: { eid: 'sub' }, project: {}, filed: { project: 'p' } },
    { entity: { eid: 'helper' }, persona: { home: 'sub' } },
    {
      entity: { eid: 'left' },
      session: { id: 'left', persona: 'helper', ended: true },
    },
    {
      entity: { eid: 's1' },
      subscription: { actor: 'left', target: 't', mode: 'watch' },
    },
    {
      entity: { eid: 's2' },
      subscription: { actor: 'operator', target: 't', mode: 'watch' },
    },
  ], { trusted: true })
  await o.write(done)
  equal(await o.heard('operator'), [`${o.id} completed by Jeff: ${TITLE}`])
  await o.write(comment('c1', 'reopening soon'), {
    by: 'taskmaster',
    via: 'operator',
  })
  equal(await o.heard('operator'), [])
})

test('a subscription watches a task, and a mute silences its watcher', async () => {
  let o = await office()
  await o.g.apply([
    {
      entity: { eid: 's1' },
      subscription: { actor: 'operator', target: 't', mode: 'watch' },
    },
    {
      entity: { eid: 's2' },
      subscription: { actor: 'worker', target: 't', mode: 'mute' },
    },
  ], { trusted: true })
  await o.write(done)
  equal(await o.heard('operator'), [`${o.id} completed by Jeff: ${TITLE}`])
  equal(await o.heard('worker'), [])
})

test('an id is mentioned whole, never as the start of a longer one', () =>
  equal(
    ['T-7 done', 'see (T-7).', 'T-77', 'XT-7', 'T-7a'].map((t) =>
      mentions(t, 'T-7')
    ),
    [true, true, false, false, true],
  ))
