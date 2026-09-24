import { assert, assertEquals } from '@std/assert'
import {
  type Bundle,
  type Comp,
  type Graph,
  graph,
  identityEid,
} from '@yaks/graph'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { loadVocab } from '@yaks/vocab'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/rules'
import { nameKeywords } from '@yaks/names'
import { kernelKeywords, spineDoc } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { effects as registry } from '@yaks/effects'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { modelDoc } from '@yaks/model'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { processDoc } from '@yaks/process'
import { effects, type Options } from './effects.ts'
import { healDoc } from './vocab.ts'

let P = identityEid('provider', ['codex'])
let M = identityEid('model', ['sol'])

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// A host with every word a failure, a task and a spawn request touch, and
// this package's handlers on it. No @yaks/spawn handlers: a fixer is the
// request written, never a process started.
let host = async (options: Options = {}, duties = true) => {
  let vocab = loadVocab(
    [
      spineDoc,
      idDoc,
      edgeDoc,
      docDoc,
      taskDoc,
      projectDoc,
      sessionDoc,
      toolsDoc,
      modelDoc,
      processDoc,
      healDoc,
    ],
    [kernelKeywords, idKeywords, nameKeywords, edgeKeywords],
  )
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [ids(vocab), fx],
  })
  for (
    let { comp, ...watch } of effects(
      { graph: g, me: 'me', config: { duties } },
      { provider: 'codex', model: 'sol', project: 'home', cap: 2, ...options },
    )
  ) fx.on(comp, watch)
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
// A failure caught on a fresh session, as a runner records one.
let fail = async (g: Graph, message: string, on = `s${++n}`) => {
  await g.apply([
    { entity: { eid: on }, session: {} },
    { entity: { eid: on }, exception: { message, at: 'then' } },
  ], { trusted: true })
  return on
}

let bugs = async (g: Graph) => await g.read('.bug')
let fixers = async (g: Graph) => await g.read('.fixer')

Deno.test('a failure files one open task about it, under its project', async () => {
  let g = await host({ provider: undefined })
  let on = await fail(g, 'no such table: bug')
  let [bug] = await bugs(g)
  assertEquals(comp(bug, 'bug')?.fault, 'session:no such table: bug')
  assertEquals(comp(bug, 'bug')?.hits, 1)
  assertEquals(comp(bug, 'doc')?.title, 'session exception: no such table: bug')
  assertEquals(comp(bug, 'filed')?.priority, 2)
  assertEquals(comp(bug, 'filed')?.project, 'home')
  assert(bug.task && !bug.completed)
  let about =
    (await g.storage.tx((tx) =>
      tx.get([edgeEid(bug.entity.eid, 'about', on)])
    ))[0]
  assertEquals(comp(about, 'edge')?.to, on)
  // The session working on a filed task files there instead.
  await g.apply([{ entity: { eid: 'run' }, exception: { message: 'x' } }], {
    trusted: true,
  })
  let there = (await bugs(g)).find((b) => b.entity.eid != bug.entity.eid)
  assertEquals(comp(there, 'filed')?.project, 'venture')
})

Deno.test('a storm counts on one task instead of filing more', async () => {
  let g = await host({ provider: undefined })
  await fail(g, 'lock held by S-1 at /a/b.ts:3:4')
  let twice = await fail(g, 'lock held by S-99 at /c.ts:1:1')
  let [bug, ...more] = await bugs(g)
  assertEquals(more.length, 0)
  assertEquals(comp(bug, 'bug')?.hits, 2)
  assert(
    String(comp(bug, 'doc')?.body).endsWith(
      'recurred 2× · last seen ' +
        comp(bug, 'bug')?.last,
    ),
  )
  // The same failure handed over again is not a third hit.
  await g.apply([{ entity: { eid: twice }, exception: null }], {
    trusted: true,
  })
  await fail(g, 'lock held by S-99 at /c.ts:1:1', twice)
  let [again, ...none] = await bugs(g)
  assertEquals(none.length, 0)
  assertEquals(comp(again, 'bug')?.hits, 2)
})

Deno.test('a transient, an empty message and an expected error file nothing', async () => {
  let g = await host({ provider: undefined })
  await fail(g, 'fetch timed out')
  await fail(g, '  ')
  await g.apply([{ entity: { eid: 'e1' }, error: { code: 'nope' } }], {
    trusted: true,
  })
  assertEquals((await bugs(g)).length, 0)
})

Deno.test('a new bug starts one fixer holding it', async () => {
  let g = await host({ effort: 'high' })
  await fail(g, 'exit 127: codex not found')
  let [bug] = await bugs(g)
  let [fixer, ...more] = await fixers(g)
  assertEquals(more.length, 0)
  assertEquals(comp(fixer, 'fixer')?.bug, bug.entity.eid)
  assert(fixer.session)
  assertEquals(comp(bug, 'claim')?.session, fixer.entity.eid)
  assertEquals(comp(bug, 'filed')?.priority, 1)
  let [ask] = await g.read(`.entry.session=${fixer.entity.eid}`)
  assertEquals(comp(ask, 'using'), {
    provider: P,
    model: M,
    effort: 'high',
  })
  assert(String(comp(ask, 'content')?.body).includes('codex not found'))
})

Deno.test('off: no provider, or no duties, files and starts nothing', async () => {
  for (let g of [await host({ provider: undefined }), await host({}, false)]) {
    await fail(g, 'boom')
    assertEquals((await bugs(g)).length, 1)
    assertEquals((await fixers(g)).length, 0)
  }
})

Deno.test('muted: nofix on the project, or on home for all', async () => {
  for (let muted of ['venture', 'home']) {
    let g = await host()
    await g.apply([{ entity: { eid: muted }, nofix: {} }], { trusted: true })
    await g.apply([{ entity: { eid: 'run' }, exception: { message: 'x' } }], {
      trusted: true,
    })
    assertEquals((await bugs(g)).length, 1)
    assertEquals((await fixers(g)).length, 0, muted)
  }
})

Deno.test('at cap: the bug waits, and starts when a fixer exits', async () => {
  let g = await host({ cap: 1 })
  await fail(g, 'first')
  await fail(g, 'second')
  assertEquals((await bugs(g)).length, 2)
  let [first, ...more] = await fixers(g)
  assertEquals(more.length, 0)
  await g.apply([
    { entity: first.entity, process: {} },
    { entity: first.entity, exit: { code: 0 } },
  ], { trusted: true })
  assertEquals((await fixers(g)).length, 2)
})

Deno.test('cooling down: a fault fixed a moment ago starts no second fixer', async () => {
  let g = await host()
  await fail(g, 'flaky write')
  let [bug] = await bugs(g)
  await g.apply([{ entity: bug.entity, completed: {}, claim: null }], {
    trusted: true,
  })
  await fail(g, 'flaky write')
  assertEquals((await bugs(g)).length, 2)
  assertEquals((await fixers(g)).length, 1)
  // With no cooldown the new bug gets its own.
  let quick = await host({ cooldown: 0 })
  await fail(quick, 'flaky write')
  let [done] = await bugs(quick)
  await quick.apply([{ entity: done.entity, completed: {}, claim: null }], {
    trusted: true,
  })
  await fail(quick, 'flaky write')
  assertEquals((await fixers(quick)).length, 2)
})

Deno.test('the boot sweep finds the open bugs nobody holds', async () => {
  let g = await host({ provider: undefined })
  await fail(g, 'one')
  await fail(g, 'two')
  let [a] = await bugs(g)
  await g.apply([{ entity: a.entity, completed: {} }], { trusted: true })
  let [sweep] = effects({ graph: g, me: 'me' }).filter((w) => w.sweep)
  let pending = await g.read(sweep.sweep!.pending)
  assertEquals(pending.length, 1)
  assert(pending[0].entity.eid != a.entity.eid)
})
