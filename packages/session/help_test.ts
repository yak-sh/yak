// A project wearing `helper` has its operator's routine taken by a helper: a
// knock no person wrote starts one session with everything waiting, one at a
// time, and only a person's words and a hand-up reach the operator, from a
// helper or from a session opened on a topic, committed and run as the rule
// (./routine.ts) and `session_help` are.

import { type Bundle, graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { signed } from '@yaks/graph/provenance'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects } from '@yaks/effects'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { processDoc } from '@yaks/process/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { topicDoc } from '@yaks/topic/vocab'
import { equal, test, throws } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { statusComputed } from './state.ts'
import { sessions } from './plugin.ts'
import { help, LIMIT, QUIET } from './help.ts'
import { hear } from './listen.ts'
import { reported } from './watch.ts'
import { runs } from './tools.ts'

let vocab = loadVocab([
  kernelDoc,
  idDoc,
  provenanceDoc,
  docDoc,
  mailDoc,
  modelDoc,
  notifyDoc,
  sessionDoc,
  toolsDoc,
  personaDoc,
  projectDoc,
  processDoc,
  taskDoc,
  edgeDoc,
  topicDoc,
], [kernelKeywords, idKeywords, edgeKeywords])

let CLAUDE = identityEid('provider', ['claude'])
let SONNET = identityEid('model', ['sonnet'])
let HELPER = { persona: 'taskmaster', provider: CLAUDE, model: SONNET }

type Row = Record<string, Record<string, unknown>>

// A project whose operator has a helper, the persona both wear, Jeff, the
// session Jeff opened and a task. `knock` leaves one at the project (or `to`)
// and runs what the commit owes; `handUp` is `session_handup` called through a
// session, written as its door writes it; `ahead` moves the helper's clock.
let office = async (helper: object | null = HELPER) => {
  let fx = effects(vocab)
  let g = graph({
    storage: ram(vocab, { computed: statusComputed, number: true }),
    vocab,
    plugins: [ids(vocab), sessions(), fx],
  })
  let ahead = 0
  fx.handle({
    session_help: (e) =>
      help(g, e.entity.eid, { now: () => Date.now() + ahead }),
  })
  let write = async (bundles: Bundle[]) => {
    await g.apply(bundles, { trusted: true })
    await fx.idle()
  }
  await write([
    { entity: { eid: 'p' }, project: {}, doc: { title: 'Task Graph' } },
    { entity: { eid: 'p' }, ...helper ? { helper } : {} },
    { entity: { eid: 'taskmaster' }, persona: { home: 'p' } },
    { entity: { eid: CLAUDE }, provider: { name: 'claude' } },
    { entity: { eid: SONNET }, model: { name: 'sonnet' } },
    {
      entity: { eid: 'jeff' },
      person: {},
      doc: { title: 'Jeff' },
      email: { address: 'jeff@example.com' },
    },
    {
      entity: { eid: 'operator' },
      session: { id: 'operator', persona: 'taskmaster', operator: true },
    },
    { entity: { eid: 'gate' }, task: {}, doc: { title: 'Fix the gate' } },
  ])
  let { session_handup } = runs({ vocab })
  let handUp = async (via: string | undefined, text: string) => {
    let call = {
      entity: { eid: 'call' },
      call: { args: { about: 'gate', text } },
      ...via ? { $actor: { via } } : {},
    }
    let made = await session_handup!(call, g) as Bundle[]
    await write(signed(made, { via }))
    return made
  }
  let n = 0
  let knock = (body: string, more: Bundle | object = {}, to = 'p') =>
    write([{
      entity: { eid: `k${++n}` },
      knock: { target: to },
      doc: { body },
      ...more,
    }])
  let letter = (from: string, title: string, more: object = {}) =>
    write([{
      entity: { eid: `e${++n}` },
      mail: { from, target: 'p', ...more },
      doc: { title, body: title },
    }])
  // Each helper, oldest first: what it wears, whom it answers to, what it was
  // asked with and told.
  let helpers = async () => {
    let rows = await g.read('.helping ?session ?spawned ?stop')
    let out = []
    for (let b of rows as (Bundle & Row)[]) {
      let [first] = await g.read(
        `.entry.session=${b.entity.eid} ?content ?using`,
      ) as (Bundle & Row)[]
      out.push({
        eid: b.entity.eid,
        persona: b.session.persona,
        parent: b.spawned?.parent,
        using: first.using,
        told: String(first.content.body).split('\n\n').slice(1)
          .map((line) => line.slice(line.indexOf(': ') + 2)),
        stopped: !!b.stop,
      })
    }
    return out
  }
  // What the operator's listener says, marked said.
  let heard = async () => {
    let lines: string[] = []
    await hear(g, null, 'operator', (line) => lines.push(line))
    return lines.map((line) => line.slice(line.indexOf(': ') + 2))
  }
  let exit = (eid: string, code: number) =>
    write([{ entity: { eid }, exit: { code } }])
  return {
    g,
    write,
    fx: () => fx.idle(),
    knock,
    handUp,
    letter,
    helpers,
    heard,
    exit,
    later: (ms: number) => ahead += ms,
  }
}

test('a knock at a helped project starts its helper, not its operator', async () => {
  let o = await office()
  await o.knock('New bug: gate failed')
  let [h, ...more] = await o.helpers()
  equal(more, [])
  equal({ ...h, eid: '' }, {
    eid: '',
    persona: 'taskmaster',
    parent: 'operator',
    using: { provider: CLAUDE, model: SONNET },
    told: ['New bug: gate failed'],
    stopped: false,
  })
  equal(await o.heard(), [])
})

test('a knock at the session a person opened for it is its helper’s too', async () => {
  let o = await office()
  await o.knock('S-9 exited 0', {}, 'operator')
  equal((await o.helpers()).map((h) => h.told), [['S-9 exited 0']])
  equal(await o.heard(), [])
})

test('a storm is one helper’s batch, and what comes while it works waits for its exit', async () => {
  let o = await office()
  await o.write(['a', 'b', 'c'].map((eid) => ({
    entity: { eid },
    knock: { target: 'p' },
    doc: { body: `bug ${eid}` },
  })))
  await o.knock('bug d')
  await o.knock('bug e')
  let [first, ...more] = await o.helpers()
  equal(first.told, ['bug a', 'bug b', 'bug c'])
  equal(more, [])
  await o.exit(first.eid, 0)
  equal((await o.helpers()).map((h) => h.told), [
    ['bug a', 'bug b', 'bug c'],
    ['bug d', 'bug e'],
  ])
  equal(await o.heard(), [])
})

test('a person’s words reach the operator, whoever relays them', async () => {
  let o = await office()
  await o.knock('C-7 on T-1 by Jeff: do it this way', {
    knock: { target: 'operator', from: 'jeff' },
  })
  await o.knock('look at this', { $actor: { by: 'jeff' } })
  await o.knock('T-1 completed by TaskMaster', {
    knock: { target: 'operator', from: 'taskmaster' },
  })
  equal(await o.heard(), ['C-7 on T-1 by Jeff: do it this way', 'look at this'])
  equal((await o.helpers()).map((h) => h.told), [[
    'T-1 completed by TaskMaster',
  ]])
})

test('an alert that arrives by mail is its helper’s, and a person’s letter the operator’s', async () => {
  let o = await office()
  await o.letter('alerts@example.com', 'tool refusals: 7 in 5 spaces')
  await o.letter('jeff@example.com', 'Re: Standup')
  equal((await o.helpers()).map((h) => h.told), [[
    'tool refusals: 7 in 5 spaces',
  ]])
  equal(await o.heard(), ['Re: Standup'])
})

test('what reaches a project filed under it, or an address filed there, is its helper’s too', async () => {
  let o = await office()
  await o.write([
    { entity: { eid: 'app' }, project: {}, filed: { project: 'p' } },
    {
      entity: { eid: 'hello' },
      email: { address: 'hello@example.com' },
      filed: { project: 'app' },
    },
  ])
  await o.write([
    {
      entity: { eid: 'at-app' },
      knock: { target: 'app' },
      doc: { body: 'bug' },
    },
    {
      entity: { eid: 'to-hello' },
      mail: { from: 'alerts@example.com', target: 'hello' },
      doc: { title: 'tool refusals', body: 'tool refusals' },
    },
  ])
  equal((await o.helpers()).map((h) => h.told), [['bug', 'tool refusals']])
  equal(await o.heard(), [])
})

test('an answer to a letter a session at work wrote stays that session’s', async () => {
  let o = await office()
  await o.write([
    { entity: { eid: 'worker' }, session: { id: 'worker' } },
    {
      entity: { eid: 'asked' },
      mail: { to: 'ann@example.com', target: 'p' },
      deliver: {},
      doc: { title: 'A question' },
      $actor: { via: 'worker' },
    },
  ])
  await o.letter('ann@example.com', 'Re: A question', { reply_to: 'asked' })
  equal(await o.helpers(), [])
  let lines: string[] = []
  await hear(o.g, null, 'worker', (line) => lines.push(line))
  equal(lines.length, 1)
})

test('a helper’s hand-up reaches the operator, and its own ending knocks nobody', async () => {
  let o = await office()
  await o.knock('New bug: gate failed')
  let [h] = await o.helpers()
  await o.handUp(h.eid, 'needs your call')
  equal(await o.heard(), ['T-1: needs your call'])
  await o.exit(h.eid, 0)
  equal(await reported(o.g, h.eid), { tasks: [] })
  equal(await o.heard(), [])
  equal((await o.helpers()).length, 1)
})

test('a session opened on a topic hands up as a helper does, and any other session’s line is the helper’s', async () => {
  let o = await office()
  await o.write([
    { entity: { eid: 'funnel' }, topic: { name: 'funnel' } },
    {
      entity: { eid: 'head' },
      session: { id: 'head', persona: 'taskmaster', topic: 'funnel' },
    },
    { entity: { eid: 'worker' }, session: { id: 'w', persona: 'taskmaster' } },
  ])
  await o.handUp('head', 'two reverts would fix it, and which is yours')
  equal(await o.helpers(), [])
  equal(await o.heard(), [
    'T-1: two reverts would fix it, and which is yours',
  ])
  await o.handUp('worker', 'landed')
  equal((await o.helpers()).map((h) => h.told), [['T-1: landed']])
  equal(await o.heard(), [])
})

test('a hand-up waits at the project while no operator can hear, and no session that works for none hands up', async () => {
  let o = await office()
  await o.write([
    { entity: { eid: 'funnel' }, topic: { name: 'funnel' } },
    {
      entity: { eid: 'head' },
      session: { id: 'head', persona: 'taskmaster', topic: 'funnel' },
    },
    { entity: { eid: 'operator' }, session: { ended: true } },
    { entity: { eid: 'stray' }, session: { id: 'stray' } },
  ])
  let [made] = await o.handUp('head', 'needs your call')
  equal(made.knock, { target: 'p', about: 'gate' })
  equal(await o.helpers(), [])
  await throws(() => o.handUp('stray', 'needs your call'), /works for one/)
  await throws(() => o.handUp(undefined, 'needs your call'), /no session/)
})

test('a helper that ended badly is handed up with what it had taken', async () => {
  let o = await office()
  await o.knock('New bug: gate failed')
  let [h] = await o.helpers()
  await o.exit(h.eid, 1)
  let [line, ...more] = await o.heard()
  equal(more, [])
  equal(
    line.replace(/#\w+|[A-Z]-\d+/g, '#'),
    'helper # exited 1, with 1 taken and maybe not handled: #',
  )
})

test('a helper still going past the limit is stopped, and the next knock starts another', async () => {
  let o = await office()
  await o.knock('bug a')
  o.later(LIMIT + 1)
  await o.knock('bug b')
  equal((await o.helpers()).map((h) => [h.told, h.stopped]), [
    [['bug a'], true],
    [['bug b'], false],
  ])
  equal((await o.heard()).map((line) => line.replace(/#\w+|[A-Z]-\d+/g, '#')), [
    'helper # was still going after 30 min and was stopped, with 1 taken ' +
    'and maybe not handled: #',
  ])
})

test('a helper that said nothing for a while is stopped with its last words', async () => {
  let o = await office()
  await o.knock('bug a')
  let [h] = await o.helpers()
  // Its run said its last words and lingers, its process still up.
  await o.write([
    { entity: { eid: h.eid }, process: { pid: 1 } },
    {
      entity: { eid: 'said' },
      entry: { session: h.eid },
      content: { body: 'A fixer is running on it.' },
      output: {},
    },
  ])
  o.later(QUIET + 1)
  await o.knock('bug b')
  equal((await o.helpers()).map((h) => [h.told, h.stopped]), [
    [['bug a'], true],
    [['bug b'], false],
  ])
  equal((await o.heard()).map((line) => line.replace(/#\w+|[A-Z]-\d+/g, '#')), [
    'helper # said nothing for 5 min and was stopped, with 1 taken and ' +
    'maybe not handled: #. Its last words: A fixer is running on it.',
  ])
})

test('a project with no helper leaves its knocks to its operator', async () => {
  let o = await office(null)
  await o.knock('New bug: gate failed')
  equal(await o.helpers(), [])
  equal(await o.heard(), ['New bug: gate failed'])
})

test('taking `helper` off a project gives what waits back to its operator', async () => {
  let o = await office()
  await o.knock('bug a')
  await o.knock('bug b')
  await o.write([{ entity: { eid: 'p' }, helper: null }])
  equal(await o.heard(), ['bug b'])
})

// A run the operator started on task `t` ended with `code`, its report a
// comment on the task that knocks the operator, `stopped` when somebody asked
// it to stop; then the helper took it, `finish` did what it did, and it exited.
let ran = async (code: number, finish: Bundle[] = [], stopped = false) => {
  let o = await office()
  await o.write([
    { entity: { eid: 't' }, task: {}, doc: { title: 'Fix the gate' } },
    { entity: { eid: 'run' }, session: { id: 'run' }, process: { pid: 2 } },
    ...stopped ? [{ entity: { eid: 'run' }, stop: {} }] : [],
    { entity: { eid: 'run' }, exit: { code } },
    {
      entity: { eid: 'report' },
      doc: { title: `run — exited ${code}`, body: 'Landed abc.' },
      comment: { target: 't' },
      knock: { target: 'operator' },
      $actor: { via: 'run' },
    },
  ])
  await o.fx()
  let [h] = await o.helpers()
  equal(await o.heard(), [])
  await o.write(finish.map((b) => ({ ...b, $actor: { via: h.eid } })))
  await o.exit(h.eid, 0)
  return (await o.heard()).map((line) => line.replace(/#\w+|[A-Z]-\d+/g, '#'))
}

test('a run the operator started reaches it as one line once its helper ends', async () => {
  let done = [{ entity: { eid: 't' }, completed: {} }]
  equal(await ran(0, done), ['# done: Fix the gate (report #)'])
  equal(await ran(0), ['# not ready: Fix the gate (report #)'])
  equal(await ran(1), ['# ended early: Fix the gate (report #)'])
  equal(await ran(143, [], true), ['# stopped: Fix the gate (report #)'])
})

test('a mark on a task the operator watches reaches it as one line, and talk about it does not', async () => {
  let o = await office()
  await o.write([
    { entity: { eid: 't' }, task: {}, doc: { title: 'Fix the gate' } },
    { entity: { eid: 'c' }, comment: { target: 't' }, doc: { body: 'hm' } },
  ])
  await o.knock('C-1 on T-1 by Fixer: hm', {
    knock: { target: 'operator', about: 'c' },
  })
  await o.write([{ entity: { eid: 't' }, completed: {} }])
  await o.knock('T-1 completed by Fixer', {
    knock: { target: 'operator', about: 't' },
  })
  let [h] = await o.helpers()
  await o.exit(h.eid, 0)
  let helpers = await o.helpers()
  for (let more of helpers.slice(1)) await o.exit(more.eid, 0)
  equal(
    (await o.heard()).map((line) => line.replace(/#\w+|[A-Z]-\d+/g, '#')),
    ['# done: Fix the gate'],
  )
})
