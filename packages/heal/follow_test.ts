// The follower reads a separate RAM tracker and writes a RAM box with no bug
// vocabulary or spawn handlers. Tests observe committed requests, never agents.

import { equal, ok, test, throws } from '@yaks/testing'
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
import { mailDoc } from '@yaks/mail/vocab'
import { modelDoc } from '@yaks/model'
import { processDoc } from '@yaks/process'
import { watches } from '@yaks/client'
import { api, subscriptions } from '@yaks/api'
import { type Fake, pair } from '../sync/testing.ts'
import { group } from '@yaks/tracker'
import { computed, trackerDoc } from '@yaks/tracker/vocab'
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
  pick(taskDoc, 'task', 'cancelled'),
  pick(projectDoc, 'project', 'filed'),
  pick(sessionDoc, 'session', 'entry', 'claim', 'using'),
  pick(toolsDoc, 'content'),
  pick(modelDoc, 'provider', 'model'),
  pick(processDoc, 'process', 'exit'),
  pick(healDoc, 'fixer', 'nofix'),
], [kernelKeywords, edgeKeywords])

let trackerVocab = loadVocab([
  pick(
    kernelDoc,
    'entity',
    'created',
    'updated',
    'resolved',
    'archived',
  ),
  pick(docDoc, 'doc'),
  pick(trackerDoc, 'bug', 'error', 'during', 'regressed'),
  pick(mailDoc, 'notified'),
], [kernelKeywords])
let trackerGraph = () =>
  graph({
    vocab: trackerVocab,
    storage: ram(trackerVocab, { computed }),
    clock: () => '2026-10-02T00:00:10Z',
  })

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
  let trackerCommits: Bundle[][] = []
  let trackerDown = false
  tracker.use({
    name: 'record',
    hooks: {
      commit: (rows) => {
        if (trackerDown) throw new Error('tracker is down')
        return rows
      },
      effect: (rows) => {
        trackerCommits.push(rows)
        return rows
      },
    },
  })
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
    open: () =>
      Object.assign(seen.watch('.bug !archived ?doc ?regressed ?resolved'), {
        mutate: (rows: Bundle[]) => tracker.apply(rows, { trusted: true }),
      }),
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
    let [row] = await tracker.get([bug])
    await reconcile(row, url, (rows) => tracker.apply(rows, { trusted: true }))
  }
  commits.length = 0
  trackerCommits.length = 0
  return {
    g,
    tracker,
    config,
    host,
    run,
    replay,
    commits,
    trackerCommits,
    errors,
    breakBox: (value: boolean) => {
      broken = value
    },
    breakTracker: (value: boolean) => {
      trackerDown = value
    },
    close: () => seen.close(),
  }
}
let rows = (g: Graph, component: string) => g.read(`.${component} *`)
let count = async (g: Graph, component: string) =>
  (await g.read(`.${component}`)).length
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
  let unavailable = false, lose = false, posts = 0
  let due: (() => void)[] = []
  let pending: Fake[] = []
  let socket: Fake
  let opened = Promise.resolve()
  let frames: (() => void)[] = []
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
    fetch: async (request) => {
      if (unavailable) throw new Error('tracker is down')
      if (new URL(request.url).pathname == '/apply') posts++
      let answer = await handler(request)
      if (lose) throw new Error('acknowledgement lost')
      return answer
    },
    connect: () => {
      let halves = pair()
      // A socket delivers in a later turn, independently of the HTTP response.
      // Queue frames so an /apply test does not also time its socket echo.
      let send = halves.server.send
      halves.server.send = (data) => frames.push(() => send(data))
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
    for (let i = 0; (!watch.ready || frames.length) && i < 100; i++) {
      while (frames.length) frames.shift()!()
      await Promise.resolve()
    }
    ok(watch.ready)
  }
  await ready()
  return {
    ...f,
    watch,
    ready,
    posts: () => posts,
    down: (value: boolean) => unavailable = value,
    lose: () => lose = true,
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
  equal(
    reconnected.watch.value.filter((row) => !row.resolved).map((row) =>
      row.entity.eid
    ),
    [replacement],
  )
  ok(reconnected.watch.value.find((row) => row.entity.eid == bug)?.resolved)
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

// Terminal work is the durable receipt for a tracker mark, across service runs.
let finished = async (mark: string) => {
  let f = await fixture({ provider: undefined })
  await f.run()
  await put(f.g, [{
    entity: { eid: taskEid(bug) },
    [mark]: { at: '2026-10-02T00:00:02Z' },
  }])
  f.commits.length = 0
  f.trackerCommits.length = 0
  return f
}

for (
  let [taskMark, bugMark] of [
    ['completed', 'resolved'],
    ['cancelled', 'archived'],
  ]
) {
  let f = await finished(taskMark)
  test(`the follower marks a ${taskMark} task's tracker bug ${bugMark}`, async () => {
    await f.run()
    equal(f.trackerCommits.length, 1)
    let [saved] = await f.tracker.get([bug])
    ok(saved[bugMark])
    equal(comp(saved, 'bug').status, bugMark)
    equal(f.commits, [])
    f.close()
  })
}

let markReplay = await finished('completed')
await markReplay.run()
markReplay.trackerCommits.length = 0
test('replaying a resolved task writes neither store', async () => {
  await markReplay.run()
  equal(markReplay.trackerCommits, [])
  equal(markReplay.commits, [])
  markReplay.close()
})

let markRetry = await finished('completed')
markRetry.breakTracker(true)
test('an owed tracker mark survives downtime and a follower restart', async () => {
  await markRetry.run()
  equal(markRetry.errors.length, 1)
  equal(markRetry.trackerCommits, [])
  ok(!(await markRetry.tracker.get([bug]))[0].resolved)
  markRetry.breakTracker(false)
  await markRetry.run()
  equal(markRetry.trackerCommits.length, 1)
  ok((await markRetry.tracker.get([bug]))[0].resolved)
  markRetry.close()
})

let archivedLater = await finished('completed')
await archivedLater.run()
await put(archivedLater.g, [{
  entity: { eid: taskEid(bug) },
  completed: null,
  cancelled: {},
}])
archivedLater.trackerCommits.length = 0
test('cancelling resolved work archives its bug once', async () => {
  await archivedLater.run()
  await archivedLater.run()
  equal(archivedLater.trackerCommits.length, 1)
  ok((await archivedLater.tracker.get([bug]))[0].archived)
  archivedLater.close()
})

let heldRegression = await fixture({ cooldown: 0, cap: 0 })
await heldRegression.run()
await put(heldRegression.g, [{
  entity: { eid: taskEid(bug) },
  completed: { at: '2026-10-02T00:00:02Z' },
}])
await put(heldRegression.tracker, [{
  entity: { eid: bug },
  regressed: { at: '2026-10-02T00:00:03Z' },
}])
heldRegression.trackerCommits.length = 0
test('a fixer gate never resolves a regression using its older task completion', async () => {
  await heldRegression.run()
  equal(heldRegression.trackerCommits, [])
  ok((await heldRegression.g.get([taskEid(bug)]))[0].completed)
  heldRegression.close()
})

let cycle = await fixture({ cooldown: 0 })
await cycle.run()
await put(cycle.g, [
  { entity: { eid: taskEid(bug) }, completed: { at: '2026-10-02T00:00:02Z' } },
  { entity: (await rows(cycle.g, 'fixer'))[0].entity, exit: {} },
])
await cycle.run()
await put(cycle.tracker, [{
  entity: { eid: 'cycle-occurrence' },
  error: {
    fault: 'missing row',
    at: '2026-10-02T00:00:03Z',
    commit: 'c'.repeat(40),
  },
}])
await group(cycle.tracker, 'cycle-occurrence')
test('resolved work regresses, reopens and resolves on its next completion', async () => {
  ok(!(await cycle.tracker.get([bug]))[0].resolved)
  await cycle.replay()
  let [task] = await cycle.g.get([taskEid(bug)])
  ok(!task.completed)
  equal(await count(cycle.g, 'task'), 1)
  equal(await count(cycle.g, 'fixer'), 2)
  await put(cycle.g, [{
    entity: task.entity,
    completed: { at: '2026-10-02T00:00:11Z' },
  }])
  cycle.trackerCommits.length = 0
  await cycle.replay()
  equal(cycle.trackerCommits.length, 1)
  ok((await cycle.tracker.get([bug]))[0].resolved)
  cycle.close()
})

let elsewhere = await finished('completed')
let emptyTracker = trackerGraph()
let emptySeen = watches(emptyTracker)
test('the follower marks the bug only in the tracker that holds its eid', async () => {
  await service(elsewhere.host, {
    ...elsewhere.config,
    trackers: ['http://empty.test', url],
    open: (address) =>
      address == url ? elsewhere.config.open!(address) : {
        ...emptySeen.watch('.bug !archived ?doc ?regressed ?resolved'),
        mutate: () => {
          throw new Error('no bug lives here')
        },
      },
  })
  equal(elsewhere.trackerCommits.length, 1)
  equal(elsewhere.errors, [])
  equal(await emptyTracker.get([bug]), [])
  elsewhere.close()
  emptySeen.close()
})

let transport = await remote()
await transport.run()
await put(transport.g, [{
  entity: { eid: taskEid(bug) },
  completed: { at: '2026-10-02T00:00:02Z' },
}])
let owed: Bundle[] = []
let sendMark = () =>
  follow(transport.g)(transport.watch.value[0], url, (rows, opts) => {
    owed = rows
    return transport.watch.mutate(rows, opts)
  })
transport.down(true)
await throws(sendMark, 'tracker is down')
transport.down(false)
test('the headless client admits a retried mark through the tracker API', async () => {
  ok(!transport.watch.value[0].resolved)
  await transport.watch.mutate(owed, { optimistic: false })
  ok((await transport.tracker.get([bug]))[0].resolved)
  equal(transport.posts(), 1)
  transport.watch.close()
  transport.close()
})

let lost = await remote()
await lost.run()
await put(lost.g, [{
  entity: { eid: taskEid(bug) },
  completed: { at: '2026-10-02T00:00:02Z' },
}])
lost.lose()
await throws(
  () => follow(lost.g)(lost.watch.value[0], url, lost.watch.mutate),
  'acknowledgement lost',
)
await lost.ready()
lost.trackerCommits.length = 0
test('a lost tracker acknowledgement replays without another write', async () => {
  ok((await lost.tracker.get([bug]))[0].resolved)
  await follow(lost.g)(lost.watch.value[0], url, lost.watch.mutate)
  equal(lost.posts(), 1)
  equal(lost.trackerCommits, [])
  lost.watch.close()
  lost.close()
})

let raced = await finished('completed')
test('a tracker regression during mark admission rejects the old completion', async () => {
  let [before] = await raced.tracker.get([bug])
  await put(raced.tracker, [{
    entity: before.entity,
    regressed: { at: '2026-10-02T00:00:03Z' },
  }])
  raced.trackerCommits.length = 0
  await throws(
    () =>
      follow(raced.g)(
        before,
        url,
        (rows) => raced.tracker.apply(rows, { trusted: true }),
      ),
    'regressed.at',
  )
  await raced.replay()
  equal(raced.trackerCommits, [])
  ok(!(await raced.tracker.get([bug]))[0].resolved)
  raced.close()
})
