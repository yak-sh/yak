// The follower reads a separate RAM tracker and writes a RAM box with no bug
// vocabulary or spawn handlers. Tests observe committed requests, never agents.

import { equal, ok, test } from '@yaks/testing'
import {
  type Bundle,
  type Comp,
  type Graph,
  graph,
  identityEid,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeEid, edgeKeywords, link } from '@yaks/edge'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { processDoc } from '@yaks/process'
import { watches } from '@yaks/client'
import { api, subscriptions } from '@yaks/api'
import { type Fake, pair } from '../sync/testing.ts'
import { group } from '@yaks/tracker'
import { fixture as trackerGraph } from '../tracker/fixture_test.ts'
import { healDoc } from './vocab.ts'
import { follow, type Options, service, taskEid, track } from './service.ts'

let url = 'http://tracker.test'
let provider = identityEid('provider', ['codex'])
let model = identityEid('model', ['sol'])
let project = identityEid('project', ['home'])
let other = identityEid('project', ['other'])
let bug = identityEid('bug', ['missing row'])
let comp = (b: Bundle, name: string) => b[name] as Comp
let pick = (doc: VocabDoc, ...names: string[]): VocabDoc => ({
  $defs: Object.fromEntries(names.map((name) => [name, doc.$defs![name]])),
})
let vocab = loadVocab([
  pick(kernelDoc, 'entity', 'created', 'updated', 'completed', 'about'),
  edgeDoc,
  pick(docDoc, 'doc'),
  pick(taskDoc, 'task'),
  pick(projectDoc, 'project', 'filed'),
  pick(sessionDoc, 'session', 'entry', 'claim', 'using'),
  pick(toolsDoc, 'content'),
  pick(modelDoc, 'provider', 'model'),
  pick(processDoc, 'process', 'exit'),
  pick(healDoc, 'fixer', 'nofix'),
], [kernelKeywords, edgeKeywords])

// Assembly and seed data are fixtures, outside each timed behavior. Every test
// owns both stores; only the vocabulary is shared.
let fixture = async (options: Options = {}) => {
  let commits: Bundle[][] = []
  let broken = false
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [{
      name: 'record',
      hooks: {
        commit: (rows) => {
          if (broken) throw new Error('box is unwritable')
          return rows
        },
        effect: (rows) => {
          commits.push(rows)
          return rows
        },
      },
    }],
  })
  await g.apply([
    { entity: { eid: provider }, provider: { name: 'codex' } },
    { entity: { eid: model }, model: { name: 'sol' } },
    { entity: { eid: project }, project: {} },
    { entity: { eid: other }, project: {} },
  ], { trusted: true })
  let tracker = trackerGraph()
  await tracker.apply([{
    entity: { eid: bug },
    bug: { fault: 'missing row', hits: 7, last: '2026-10-02T00:00:01Z' },
    doc: { title: 'TypeError: missing row\nstack stays in tracker' },
  }], { trusted: true })
  let seen = watches(tracker)
  let config: Options = {
    provider,
    model,
    project,
    effort: 'high',
    trackers: [url],
    open: () => seen.watch('.bug.status=open ?doc ?regressed'),
    ...options,
  }
  let errors: unknown[] = []
  let host = {
    graph: g,
    report: (error: unknown) => {
      errors.push(error)
    },
  }
  let run = () => service(host, config)
  let reconcile = follow(g, config)
  let replay = async () => {
    let [row] = await tracker.read('.bug.status=open ?doc ?regressed')
    await reconcile(row, url)
  }
  commits.length = 0
  return {
    g,
    tracker,
    config,
    host,
    run,
    replay,
    commits,
    errors,
    breakBox: (value: boolean) => {
      broken = value
    },
    close: () => seen.close(),
  }
}
let rows = (g: Graph, component: string) => g.read(`.${component} *`)
let count = async (g: Graph, component: string) =>
  (await rows(g, component)).length
let put = (g: Graph, bundles: Bundle[]) => g.apply(bundles, { trusted: true })

let fresh = await fixture()
test('the tracker follower files task, evidence edge and fixer atomically', async () => {
  await fresh.replay()
  let { g, tracker, commits } = fresh
  equal(commits.length, 1)
  let written = await g.get(commits[0].map((row) => row.entity.eid))
  let task = written.find((row) => row.task)!
  let fixer = written.find((row) => row.fixer)!
  let entry = written.find((row) => row.entry)!
  equal(task.entity.eid, taskEid(bug))
  equal(comp(task, 'filed'), { project, priority: 1 })
  equal(comp(task, 'claim').session, fixer.entity.eid)
  equal(comp(fixer, 'fixer').bug, bug)
  equal(comp(fixer, 'session').operator, false)
  equal(comp(entry, 'entry').session, fixer.entity.eid)
  equal(comp(entry, 'using'), { provider, model, effort: 'high' })
  ok(String(comp(entry, 'content').body).includes('missing row'))
  equal(
    written.find((row) =>
      row.entity.eid == edgeEid(task.entity.eid, 'about', bug)
    )!.edge,
    {
      from: task.entity.eid,
      to: bug,
    },
  )
  ok(String(comp(task, 'doc').body).includes(`${url}/${bug}`))
  ok(!task.bug && !String(comp(task, 'doc').body).includes('stack'))
  equal(comp((await tracker.get([bug]))[0], 'bug').hits, 7)
  fresh.close()
})

let replayed = await fixture()
await replayed.run()
replayed.commits.length = 0
test('a second follower and a replay leave the box untouched', async () => {
  await replayed.run()
  await replayed.replay()
  equal(replayed.commits, [])
  equal(await count(replayed.g, 'task'), 1)
  equal(await count(replayed.g, 'fixer'), 1)
  replayed.close()
})

for (let gate of ['provider', 'nofix', 'cap', 'cooldown']) {
  let f = await fixture(
    gate == 'provider'
      ? { provider: undefined }
      : gate == 'cap'
      ? { cap: 0 }
      : {},
  )
  if (gate == 'nofix') await put(f.g, [{ entity: { eid: project }, nofix: {} }])
  if (gate == 'cooldown') {
    await put(f.g, [{
      entity: { eid: identityEid('old_fixer', [bug]) },
      fixer: { bug },
      session: {},
      exit: {},
    }])
  }
  f.commits.length = 0
  test(`the follower's ${gate} gate files the task without a fixer`, async () => {
    await f.run()
    equal(f.commits.length, 1)
    equal(await count(f.g, 'task'), 1)
    equal(await count(f.g, 'about'), 1)
    equal(await count(f.g, 'entry'), 0)
    let [task] = await rows(f.g, 'task')
    ok(!task.claim)
    f.close()
  })
}

let regressed = await fixture({ cooldown: 0 })
await regressed.run()
await put(regressed.g, [
  { entity: { eid: taskEid(bug) }, completed: { at: '2026-10-02T00:00:02Z' } },
  { entity: (await rows(regressed.g, 'fixer'))[0].entity, exit: {} },
])
await put(regressed.tracker, [
  { entity: { eid: bug }, resolved: { at: '2026-10-02T00:00:02Z' } },
  {
    entity: { eid: 'occurrence' },
    error: {
      fault: 'missing row',
      at: '2026-10-02T00:00:03Z',
      commit: 'b'.repeat(40),
    },
  },
])
await group(regressed.tracker, 'occurrence')
regressed.commits.length = 0
test('a tracker regression starts a new fixer on its completed task once', async () => {
  await regressed.run()
  await regressed.replay()
  equal(regressed.commits.length, 1)
  equal(await count(regressed.g, 'task'), 1)
  equal(await count(regressed.g, 'fixer'), 2)
  let [task] = await rows(regressed.g, 'task')
  ok(!task.completed)
  let held = (await regressed.g.get([String(comp(task, 'claim').session)]))[0]
  equal(comp(held, 'fixer').bug, bug)
  regressed.close()
})

let done = await fixture({ cooldown: 0 })
await done.run()
await put(done.g, [{
  entity: { eid: taskEid(bug) },
  completed: { at: '2026-10-02T00:00:02Z' },
}])
await put(done.tracker, [{
  entity: { eid: bug },
  bug: { last: '2026-10-02T00:00:03Z' },
}])
done.commits.length = 0
test('a completed task waits for a regression, not another occurrence', async () => {
  await done.run()
  equal(done.commits, [])
  done.close()
})

let retry = await fixture({ provider: undefined })
retry.breakBox(true)
test('the service retries an unwritable box without another tracker event', async () => {
  let waits = 0
  let stop = new AbortController()
  await service(retry.host, {
    ...retry.config,
    wait: async () => {
      if (++waits == 1) {
        equal(
          await retry.g.get([
            taskEid(bug),
            edgeEid(taskEid(bug), 'about', bug),
          ]),
          [],
        )
        retry.breakBox(false)
      } else stop.abort()
    },
  }, stop.signal)
  equal(retry.errors.length, 1)
  let saved = await retry.g.get([
    taskEid(bug),
    edgeEid(taskEid(bug), 'about', bug),
  ])
  equal(saved.length, 2)
  ok(saved.some((row) => row.task))
  ok(saved.some((row) => row.about))
  retry.close()
})

let outage = await fixture({ provider: undefined })
test('the service resumes when a tracker is available again', async () => {
  let opens = 0, waits = 0, closed = 0
  let stop = new AbortController()
  await service(outage.host, {
    ...outage.config,
    open: (address) => {
      equal(address, url)
      if (++opens == 1) throw new Error('tracker is down')
      let watch = outage.config.open!(address)
      return {
        ...watch,
        close: () => {
          closed++
          watch.close()
        },
      }
    },
    wait: () => {
      if (++waits == 2) stop.abort()
      return Promise.resolve()
    },
  }, stop.signal)
  equal(outage.errors.length, 1)
  equal(closed, 1)
  equal(await count(outage.g, 'task'), 1)
  equal(await count(outage.g, 'fixer'), 0)
  outage.close()
})

let migrated = await fixture()
let old = identityEid('task', ['old bug task'])
await put(migrated.g, [{
  entity: { eid: old },
  task: {},
  doc: { title: 'Old work' },
  filed: { project: other },
}, link(old, 'about', bug)])
test('the follower reuses a task already linked to its tracker bug', async () => {
  await migrated.run()
  equal(await count(migrated.g, 'task'), 1)
  ok((await migrated.g.get([old]))[0].claim)
  migrated.close()
})

// The transport uses the graph's API and sync's socket pairs, with no network.
let remote = async () => {
  let f = await fixture({ provider: undefined })
  let due: (() => void)[] = []
  let pending: Fake[] = []
  let socket: Fake
  let opened = Promise.resolve()
  let handler = api({
    graph: f.tracker,
    subs: subscriptions(f.tracker),
    upgrade: () => ({
      socket: pending.shift()!,
      response: new Response(null, { status: 101 }),
    }),
    socketTimer: () => {},
  })
  let watch = track(url, {
    fetch: (request) => handler(request),
    connect: () => {
      let halves = pair()
      socket = halves.client
      pending.push(halves.server)
      opened = Promise.resolve(handler(
        new Request(`${url}/ws`, {
          headers: { upgrade: 'websocket' },
        }),
      )).then(() => {
        halves.server.emit('open')
        halves.client.emit('open')
      })
      return socket
    },
    timer: (fn) => due.push(fn),
    report: (trouble) => {
      f.errors.push(trouble)
    },
  })
  let ready = async () => {
    await opened
    // No wall-clock timer: let the API and replica's already-queued work land.
    for (let i = 0; !watch.ready && i < 100; i++) await Promise.resolve()
    ok(watch.ready)
  }
  await ready()
  return {
    ...f,
    watch,
    ready,
    drop: () => socket.close(),
    reconnect: () => due.shift()?.(),
  }
}

let offline = await remote()
offline.drop()
test('a disconnected tracker answer cannot file its cached bugs', async () => {
  ok(!offline.watch.ready)
  equal(offline.watch.value.length, 1)
  await service(offline.host, { ...offline.config, open: () => offline.watch })
  equal(await count(offline.g, 'task'), 0)
  equal(offline.commits, [])
  offline.close()
})

let reconnected = await remote()
reconnected.drop()
let replacement = identityEid('bug', ['another failure'])
await put(reconnected.tracker, [
  { entity: { eid: bug }, resolved: {} },
  {
    entity: { eid: replacement },
    bug: { fault: 'another failure', hits: 1 },
    doc: { title: 'Another failure' },
  },
])
test('the headless tracker reconnect replaces stale query membership', async () => {
  equal(
    (await reconnected.tracker.read('.bug.status=open ?doc ?regressed')).map((
      row,
    ) => row.entity.eid),
    [replacement],
  )
  reconnected.reconnect()
  await reconnected.ready()
  equal(reconnected.watch.value.map((row) => row.entity.eid), [replacement])
  reconnected.watch.close()
  reconnected.close()
})

let cooled = await fixture()
await cooled.run()
await put(cooled.g, [
  { entity: { eid: taskEid(bug) }, completed: { at: '2026-10-02T00:00:02Z' } },
  { entity: (await rows(cooled.g, 'fixer'))[0].entity, exit: {} },
])
await put(cooled.tracker, [{
  entity: { eid: bug },
  regressed: { at: '2026-10-02T00:00:03Z' },
}])
cooled.commits.length = 0
test('cooldown leaves regressed work done until a later pass can request its fixer', async () => {
  await cooled.run()
  equal(cooled.commits, [])
  ok((await cooled.g.get([taskEid(bug)]))[0].completed)
  await service(cooled.host, { ...cooled.config, cooldown: 0 })
  equal(await count(cooled.g, 'fixer'), 2)
  ok(!(await cooled.g.get([taskEid(bug)]))[0].completed)
  cooled.close()
})
