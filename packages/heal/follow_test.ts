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
import { statusComputed } from '../session/state.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { modelDoc } from '@yaks/model'
import { processDoc } from '@yaks/process'
import { watches } from '@yaks/client'
import { api, subscriptions } from '@yaks/api'
import { apiDoc } from '@yaks/api/vocab'
import { and, every, present } from '@yaks/query'
import { type Fake, pair } from '../sync/testing.ts'
import { group } from '@yaks/tracker'
import { computed, trackerDoc } from '@yaks/tracker/vocab'
import { healDoc } from './vocab.ts'
import { fixing } from './fix.ts'
import {
  follow,
  type Options,
  PLATFORM,
  service,
  taskEid,
  track,
} from './service.ts'

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
  pick(kernelDoc, 'entity', 'created', 'completed', 'about'),
  edgeDoc,
  pick(docDoc, 'doc'),
  pick(taskDoc, 'task', 'cancelled'),
  pick(projectDoc, 'project', 'filed'),
  pick(sessionDoc, 'session', 'entry', 'claim', 'using', 'native', 'stop'),
  pick(toolsDoc, 'content', 'output', 'exception'),
  pick(modelDoc, 'provider', 'model'),
  pick(processDoc, 'process', 'exit'),
  pick(healDoc, 'fixer', 'nofix'),
  pick(notifyDoc, 'knock'),
], [kernelKeywords, edgeKeywords])

let trackerVocab = loadVocab([
  apiDoc,
  pick(
    kernelDoc,
    'entity',
    'created',
    'resolved',
    'archived',
  ),
  pick(docDoc, 'doc'),
  pick(trackerDoc, 'bug', 'error', 'during', 'regressed', 'taken', 'resolved'),
  pick(mailDoc, 'notified'),
], [kernelKeywords])
let bareTrackerVocab = loadVocab(
  trackerVocab.docs.map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).filter(([name]) => name !== 'created'),
    ),
  })),
  [kernelKeywords],
)
let trackerGraph = (unstamped = false) => {
  let schema = unstamped ? bareTrackerVocab : trackerVocab
  return graph({
    vocab: schema,
    storage: ram(schema, { computed }),
    clock: () => '2026-10-02T00:00:10Z',
  })
}

// Assembly and seed data are fixtures, outside each timed behavior. Every test
// owns both stores; only the vocabulary is shared.
let unstampedVocab = loadVocab(
  vocab.docs.map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).filter(([name]) => name !== 'created'),
    ),
  })),
  [kernelKeywords, edgeKeywords],
)
let fixture = async (options: Options = {}, unstamped = false) => {
  let schema = unstamped ? unstampedVocab : vocab
  let commits: Bundle[][] = []
  let broken = false
  let g = graph({
    vocab: schema,
    storage: ram(schema, { computed: statusComputed }),
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
  let tracker = trackerGraph(unstamped)
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
      Object.assign(
        seen.watch('.bug ?doc ?regressed ?resolved ?archived ?taken'),
        {
          mutate: (rows: Bundle[]) => tracker.apply(rows, { trusted: true }),
        },
      ),
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
let selected = Object.fromEntries(
  vocab.all.map((name) => [name, and(present(name))]),
)
let whole = Object.fromEntries(
  vocab.all.map((name) => [name, and(present(name), every())]),
)
let rows = (g: Graph, component: string) => g.read(whole[component])
let count = async (g: Graph, component: string) =>
  (await g.read(selected[component])).length
let put = (g: Graph, bundles: Bundle[]) => g.apply(bundles, { trusted: true })

let fresh = await fixture({}, true)
let [freshBug] = await fresh.tracker.get([bug])
let fileFresh = follow(fresh.g, fresh.config)
test('the tracker follower files task, evidence edge and fixer atomically', async () => {
  await fileFresh(freshBug, url, (rows) => put(fresh.tracker, rows))
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
  ok(String(comp(entry, 'content').body).includes(`yak bug resolve ${bug} `))
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
  let knock = written.find((row) => row.knock)!
  equal(comp(knock, 'knock').target, project)
  ok(String(comp(knock, 'doc').body).includes('TypeError: missing row'))
  fresh.close()
})

let took = await fixture()
await took.replay()
let marked = took.trackerCommits.length
test('a started fixer marks its bug taken in the tracker, once', async () => {
  let [row] = await took.tracker.get([bug])
  let [task] = await took.g.get([taskEid(bug)])
  equal(comp(row, 'taken').task, task.entity.num ? undefined : task.entity.eid)
  await took.replay()
  await took.run()
  equal(took.trackerCommits.length, marked)
  took.close()
})

// An older tracker refuses the mark it doesn't know yet (a deploy in between).
let unmarked = await fixture()
let refusing = follow(unmarked.g, unmarked.config)
let refused = await (async () => {
  let [row] = await unmarked.tracker.get([bug])
  return refusing(row, url, () => Promise.reject(Error('no take door')))
})().then(() => undefined, (error: Error) => error.message)
test('a tracker refusing the taken mark never holds back the fixer', async () => {
  equal(refused, 'no take door')
  equal(await count(unmarked.g, 'fixer'), 1)
  await unmarked.replay()
  ok(comp((await unmarked.tracker.get([bug]))[0], 'taken'))
  unmarked.close()
})

let replayed = await fixture()
await replayed.run()
replayed.commits.length = 0
test('a second follower and a replay leave the box untouched', async () => {
  await replayed.run()
  await replayed.replay()
  equal(replayed.commits, [])
  equal(await count(replayed.g, 'task'), 1)
  equal(await count(replayed.g, 'knock'), 1)
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
  if (gate == 'nofix') {
    await put(f.g, [{ entity: { eid: project }, nofix: {} }])
  }
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

// Completed work whose resolved bug came back.
let regression = async () => {
  let f = await fixture({ cooldown: 0 })
  await f.run()
  await put(f.g, [
    {
      entity: { eid: taskEid(bug) },
      completed: { at: '2026-10-02T00:00:02Z' },
    },
    { entity: (await rows(f.g, 'fixer'))[0].entity, exit: {} },
  ])
  await put(f.tracker, [
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
  await group(f.tracker, 'occurrence')
  f.commits.length = 0
  return f
}

let regressed = await regression()
test('a tracker regression starts a new fixer on its completed task', async () => {
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

let restarted = await regression()
await restarted.replay()
restarted.commits.length = 0
test('a tracker regression starts its new fixer once', async () => {
  await restarted.replay()
  equal(restarted.commits, [])
  equal(await count(restarted.g, 'fixer'), 2)
  restarted.close()
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

let retry = await fixture({ provider: undefined }, true)
retry.breakBox(true)
let retryWatch = retry.config.open!(url)
test('the service retries an unwritable box without another tracker event', async () => {
  let waits = 0
  let stop = new AbortController()
  await service(retry.host, {
    ...retry.config,
    open: () => retryWatch,
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

let flood = await fixture({ provider: undefined })
let gone = [1, 2, 3].map((n) => identityEid('bug', [`gone ${n}`]))
await put(
  flood.tracker,
  gone.map((eid) => ({
    entity: { eid },
    bug: { fault: eid, hits: 1, last: '2026-10-02T00:00:01Z' },
    doc: { title: 'Gone' },
    resolved: {},
  })),
)
// Every entity the passes read, which names each bug's work.
let floodRead: string[] = []
let floodGraph = flood.g
let watchedFlood = Object.create(floodGraph, {
  get: {
    value: (eids: string[], ...rest: never[]) => (
      floodRead.push(...eids), floodGraph.get(eids, ...rest)
    ),
  },
})
let floodHits = 7
let floodStop = new AbortController()
await service({ ...flood.host, graph: watchedFlood }, {
  ...flood.config,
  wait: async () => {
    if (++floodHits == 12) return floodStop.abort()
    await put(flood.tracker, [{
      entity: { eid: bug },
      bug: { hits: floodHits },
    }])
  },
}, floodStop.signal)
let asked = (b: string) => floodRead.filter((eid) => eid == taskEid(b)).length
// The completed replay is the fixture; timed checks inspect its observations.
flood.close()
test('a flood of hits on one bug replays it, not every closed bug', () => {
  equal(gone.map(asked), [1, 1, 1])
  ok(asked(bug) > 2)
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
  await migrated.replay()
  equal(await count(migrated.g, 'task'), 1)
  ok((await migrated.g.get([old]))[0].claim)
  migrated.close()
})

// The transport uses the graph's API and sync's socket pairs, with no network.
let remote = async (unstamped = false) => {
  let f = await fixture({ provider: undefined }, unstamped)
  let unavailable = false, lose = false, posts = 0
  let due: (() => void)[] = []
  let pending: Fake[] = []
  let socket: Fake
  let next = pair()
  let request = new Request(`${url}/ws`, {
    headers: { upgrade: 'websocket' },
  })
  let response = new Response(null, { status: 101 })
  let opened = Promise.resolve()
  let frames: (() => void)[] = []
  let handler = api({
    graph: f.tracker,
    subs: subscriptions(f.tracker),
    upgrade: () => ({
      socket: pending.shift()!,
      response,
    }),
    socketTimer: () => {},
  })
  let prepare = () => {
    let halves = next
    let send = halves.server.send
    halves.server.send = (data) => frames.push(() => send(data))
    pending.push(halves.server)
    let upgraded = Promise.resolve(handler(request))
    return { halves, upgraded }
  }
  let prepared = prepare()
  let watch = track(url, {
    fetch: async (request) => {
      if (unavailable) throw new Error('tracker is down')
      if (new URL(request.url).pathname == '/apply') posts++
      let answer = await handler(request)
      if (lose) throw new Error('acknowledgement lost')
      return answer
    },
    connect: () => {
      let { halves, upgraded } = prepared
      socket = halves.client
      // Only transport assembly is prepared; opening the connection still
      // sends the real query through the API and replaces replica membership.
      opened = upgraded.then(() => {
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
    lose: (value = true) => lose = value,
    drop: () => {
      socket.close()
      next = pair()
      prepared = prepare()
    },
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

let reconnected = await remote(true)
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
let reconnectMembers = await reconnected.tracker.read(
  '.bug.status=open ?doc ?regressed',
)
test('the headless tracker reconnect replaces stale query membership', async () => {
  equal(reconnectMembers.map((row) => row.entity.eid), [replacement])
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

// Completed work whose bug regressed inside the fixer's cooldown.
let cooling = async () => {
  let f = await fixture()
  await f.run()
  await put(f.g, [
    {
      entity: { eid: taskEid(bug) },
      completed: { at: '2026-10-02T00:00:02Z' },
    },
    { entity: (await rows(f.g, 'fixer'))[0].entity, exit: {} },
  ])
  await put(f.tracker, [{
    entity: { eid: bug },
    regressed: { at: '2026-10-02T00:00:03Z' },
  }])
  f.commits.length = 0
  return f
}

let cooled = await cooling()
test('cooldown leaves regressed work done', async () => {
  await cooled.run()
  equal(cooled.commits, [])
  ok((await cooled.g.get([taskEid(bug)]))[0].completed)
  cooled.close()
})

let cooldown = await cooling()
test('a later pass past the cooldown requests the regressed work its fixer', async () => {
  await service(cooldown.host, { ...cooldown.config, cooldown: 0 })
  equal(await count(cooldown.g, 'fixer'), 2)
  ok(!(await cooldown.g.get([taskEid(bug)]))[0].completed)
  cooldown.close()
})

for (
  let [bugMark, taskMark] of [
    ['resolved', 'completed'],
    ['archived', 'cancelled'],
  ]
) {
  let f = await remote()
  await f.replay()
  await put(f.tracker, [{
    entity: { eid: bug },
    [bugMark]: { at: '2026-10-02T00:00:02Z' },
  }])
  await f.ready()
  test(`the headless answer carries a tracker ${bugMark} mark to its task`, async () => {
    let row = f.watch.value.find((row) => row.entity.eid == bug)!
    ok(row[bugMark])
    await follow(f.g)(row, url, f.watch.mutate)
    ok((await f.g.get([taskEid(bug)]))[0][taskMark])
    f.watch.close()
    f.close()
  })
}

// Tracker marks close existing work without requesting another fixer.
for (
  let [bugMark, taskMark] of [
    ['resolved', 'completed'],
    ['archived', 'cancelled'],
  ]
) {
  let f = await fixture()
  await f.replay()
  await put(f.tracker, [{
    entity: { eid: bug },
    [bugMark]: { at: '2026-10-02T00:00:02Z' },
  }])
  f.commits.length = 0
  f.trackerCommits.length = 0
  test(`a tracker ${bugMark} mark closes its task once`, async () => {
    await f.replay()
    await f.replay()
    let [task] = await f.g.get([taskEid(bug)])
    equal(comp(task, taskMark).at, '2026-10-02T00:00:02Z')
    equal(f.commits.length, 1)
    equal(f.trackerCommits, [])
    equal(await count(f.g, 'fixer'), 1)
    f.close()
  })

  let empty = await fixture()
  await put(empty.tracker, [{ entity: { eid: bug }, [bugMark]: {} }])
  empty.trackerCommits.length = 0
  test(`a tracker ${bugMark} bug without work creates no task`, async () => {
    await empty.replay()
    equal(empty.commits, [])
    equal(empty.trackerCommits, [])
    empty.close()
  })
}

let archiveDone = await fixture({ provider: undefined })
let linkedTask = identityEid('task', ['linked completed work'])
await put(archiveDone.g, [{
  entity: { eid: linkedTask },
  task: {},
  completed: { at: '2026-10-02T00:00:01Z' },
}, link(linkedTask, 'about', bug)])
await put(archiveDone.tracker, [{ entity: { eid: bug }, archived: {} }])
archiveDone.trackerCommits.length = 0
test('tracker archival cancels completed work linked under an older task id', async () => {
  await archiveDone.replay()
  let [task] = await archiveDone.g.get([linkedTask])
  ok(task.cancelled && !task.completed)
  equal(archiveDone.trackerCommits, [])
  equal(await count(archiveDone.g, 'task'), 1)
  archiveDone.close()
})

let closeRetry = await fixture({ provider: undefined })
await closeRetry.replay()
await put(closeRetry.tracker, [{ entity: { eid: bug }, resolved: {} }])
closeRetry.breakBox(true)
await throws(closeRetry.replay, 'box is unwritable')
closeRetry.breakBox(false)
test('a failed task closure retries the tracker resolution', async () => {
  ok(!(await closeRetry.g.get([taskEid(bug)]))[0].completed)
  await closeRetry.replay()
  ok((await closeRetry.g.get([taskEid(bug)]))[0].completed)
  closeRetry.close()
})

let trackerCycle = await fixture({ cooldown: 0 })
await trackerCycle.replay()
await put(trackerCycle.g, [{
  entity: (await rows(trackerCycle.g, 'fixer'))[0].entity,
  exit: {},
}])
await put(trackerCycle.tracker, [{
  entity: { eid: bug },
  resolved: { at: '2026-10-02T00:00:02Z' },
}])
await trackerCycle.replay()
await put(trackerCycle.tracker, [{
  entity: { eid: 'tracker-cycle-occurrence' },
  error: {
    fault: 'missing row',
    at: '2026-10-02T00:00:03Z',
    commit: 'd'.repeat(40),
  },
}])
await group(trackerCycle.tracker, 'tracker-cycle-occurrence')
test('a regression reopens work closed by a tracker resolution', async () => {
  await trackerCycle.replay()
  await trackerCycle.replay()
  ok(!(await trackerCycle.g.get([taskEid(bug)]))[0].completed)
  equal(await count(trackerCycle.g, 'task'), 1)
  equal(await count(trackerCycle.g, 'fixer'), 2)
  trackerCycle.close()
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

let cancelledWork = await finished('cancelled')
test("the follower marks a cancelled task's tracker bug archived", async () => {
  await cancelledWork.run()
  equal(cancelledWork.trackerCommits.length, 1)
  let [saved] = await cancelledWork.tracker.get([bug])
  equal(comp(saved, 'bug').status, 'archived')
  equal(cancelledWork.commits, [])
  cancelledWork.close()
})

// A resolution is explained by whoever resolves the bug; completed work has
// no explanation to give, so its bug stays open until one is written.
let completedWork = await finished('completed')
test("a completed task leaves its tracker bug open for the fixer's explained resolution", async () => {
  await completedWork.run()
  equal(completedWork.trackerCommits, [])
  equal(comp((await completedWork.tracker.get([bug]))[0], 'bug').status, 'open')
  completedWork.close()
})

let markReplay = await finished('cancelled')
await markReplay.run()
markReplay.trackerCommits.length = 0
test('replaying an archived task writes neither store', async () => {
  await markReplay.run()
  equal(markReplay.trackerCommits, [])
  equal(markReplay.commits, [])
  markReplay.close()
})

let down = await finished('cancelled')
down.breakTracker(true)
test('a tracker down at its owed mark reports the failure and writes nothing', async () => {
  await down.run()
  equal(down.errors.length, 1)
  equal(down.trackerCommits, [])
  ok(!(await down.tracker.get([bug]))[0].archived)
  down.close()
})

let markRetry = await finished('cancelled')
markRetry.breakTracker(true)
await markRetry.run()
markRetry.breakTracker(false)
test('an owed tracker mark survives downtime and a follower restart', async () => {
  await markRetry.run()
  equal(markRetry.trackerCommits.length, 1)
  ok((await markRetry.tracker.get([bug]))[0].archived)
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
test('cancelling completed work archives its bug once', async () => {
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
test('a fixer gate leaves a regressed task completed and its bug open', async () => {
  await heldRegression.run()
  equal(heldRegression.trackerCommits, [])
  ok((await heldRegression.g.get([taskEid(bug)]))[0].completed)
  heldRegression.close()
})

let elsewhere = await finished('cancelled')
let emptyTracker = trackerGraph()
let emptySeen = watches(emptyTracker)
test('the follower marks the bug only in the tracker that holds its eid', async () => {
  await service(elsewhere.host, {
    ...elsewhere.config,
    trackers: ['http://empty.test', url],
    open: (address) =>
      address == url ? elsewhere.config.open!(address) : {
        ...emptySeen.watch('.bug ?doc ?regressed ?resolved ?archived'),
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

let transport = await remote(true)
await transport.run()
await put(transport.g, [{
  entity: { eid: taskEid(bug) },
  cancelled: { at: '2026-10-02T00:00:02Z' },
}])
let transportBug = transport.watch.value[0]
let markKeys: (string | undefined)[] = []
let sendMark = () =>
  follow(transport.g)(transportBug, url, (rows, opts) => {
    markKeys.push(opts?.key)
    return transport.watch.mutate(rows, opts)
  })
transport.down(true)
await throws(sendMark, 'tracker is down')
transport.down(false)
// Replay through the real tracker API before checking its receipt. Capture
// the pre-send state too, so retry acceptance cannot hide an early archive.
let retryBefore = !!transport.watch.value[0].archived
await sendMark()
let retriedMark = {
  before: retryBefore,
  keys: [...markKeys],
  archived: !!(await transport.tracker.get([bug]))[0].archived,
  posts: transport.posts(),
}
transport.watch.close()
transport.close()
test('the headless client admits a retried mark through the tracker API', () => {
  ok(!retriedMark.before)
  ok(retriedMark.keys[0])
  equal(retriedMark.keys[1], retriedMark.keys[0])
  ok(retriedMark.archived)
  equal(retriedMark.posts, 1)
})

let lost = await remote()
await lost.run()
await put(lost.g, [{
  entity: { eid: taskEid(bug) },
  cancelled: { at: '2026-10-02T00:00:02Z' },
}])
let lostBug = lost.watch.value[0]
lost.lose()
await throws(
  () => follow(lost.g)(lostBug, url, lost.watch.mutate),
  'acknowledgement lost',
)
await lost.ready()
lost.trackerCommits.length = 0
test('a lost tracker acknowledgement replays without another write', async () => {
  ok((await lost.tracker.get([bug]))[0].archived)
  lost.lose(false)
  await follow(lost.g)(lostBug, url, lost.watch.mutate)
  equal(lost.posts(), 2)
  equal(lost.trackerCommits, [])
  lost.watch.close()
  lost.close()
})

let raced = await finished('cancelled')
test('a tracker regression during mark admission rejects the stale answer', async () => {
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
  equal(raced.trackerCommits, [])
  ok(!(await raced.tracker.get([bug]))[0].archived)
  raced.close()
})

let ordered = await fixture({ provider: undefined })
test('the platform tracker is followed first', async () => {
  let opened: string[] = []
  await service(ordered.host, {
    ...ordered.config,
    remote: { url: 'https://tracker.example' },
    open: (at) => {
      opened.push(at)
      return { ...ordered.config.open!(at), value: [] }
    },
  })
  equal(opened, [PLATFORM, url])
  ordered.close()
})

// The body of the platform bug's task, filed by a follower that knows which
// trackers have a web of their own.
let platform = async (trackers: string[]) => {
  let f = await fixture({ trackers, provider: undefined })
  let [row] = await f.tracker.get([bug])
  let reconcile = follow(f.g, f.config)
  return async () => {
    await reconcile(row, PLATFORM, (rows) => put(f.tracker, rows))
    let [task] = await f.g.get([taskEid(bug)])
    f.close()
    return String(comp(task, 'doc').body)
  }
}

let withWeb = await platform([url])
test("a platform bug's task links its page on the tracker web", async () => {
  ok((await withWeb()).includes(`(${url}/?q=.bug&side=yaks.app&bug=${bug})`))
})

let noWeb = await platform([])
test("with no tracker web, a platform bug's task names the command that reads it", async () => {
  ok((await noWeb()).includes(`yak bug show ${bug} --source yaks.app`))
})

let held = await fixture({ provider: undefined })
test("until the platform's first poll settles, no other tracker's bug takes a slot", async () => {
  let listeners: ((bundles: Bundle[]) => void)[] = []
  let polled = { ready: false }
  let stop = new AbortController()
  let before = -1, waits = 0
  await service(held.host, {
    ...held.config,
    remote: { url: 'https://tracker.example' },
    open: (at) =>
      at == 'yaks.app'
        ? {
          query: '.bug',
          value: [] as Bundle[],
          get ready() {
            return polled.ready
          },
          subscribe: (fn: (bundles: Bundle[]) => void) => (
            listeners.push(fn), () => {}
          ),
          close: () => {},
          mutate: (rows: Bundle[]) => Promise.resolve(rows),
        }
        : held.config.open!(at),
    wait: async () => {
      if (++waits == 1) {
        before = await count(held.g, 'task')
        polled.ready = true
        for (let fn of listeners) fn([])
      } else if (await count(held.g, 'task') > 0 || waits > 20) stop.abort()
    },
  }, stop.signal)
  equal(before, 0)
  equal(await count(held.g, 'task'), 1)
  held.close()
})

// Native fixers have no per-session process. Their transcript alone keeps a
// slot after the managed startup window and releases it at a terminal stop.
let nativeCase = async (ended: boolean, recent = false) => {
  let f = await fixture({ cap: 1 })
  let holder = crypto.randomUUID()
  let created = recent ? new Date().toISOString() : '2026-01-01T00:00:00Z'
  await put(f.g, [
    {
      entity: { eid: holder },
      session: {},
      native: {},
      fixer: { bug },
      created: { at: created },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: holder },
      content: { body: 'Fix this bug' },
      using: { provider },
    },
    ...(ended
      ? [{
        entity: { eid: crypto.randomUUID() },
        entry: { session: holder },
        stop: {},
      }]
      : []),
  ])
  return { f, holder }
}
let nativeRunning = await nativeCase(false)
await put(nativeRunning.f.g, [{
  entity: { eid: nativeRunning.holder },
  fixer: { bug: identityEid('bug', ['another-bug']) },
}])
test('a native fixer still holds the cap after five minutes without a process', async () => {
  let { f } = nativeRunning
  await f.replay()
  equal(await count(f.g, 'fixer'), 1)
  ok(!(await f.g.get([taskEid(bug)]))[0].claim)
  f.close()
})
let nativeStopped = await nativeCase(true)
test('a stopped native transcript releases the fixer cap without an exit', async () => {
  let { f } = nativeStopped
  await put(f.g, [{
    entity: { eid: nativeStopped.holder },
    fixer: { bug: identityEid('bug', ['another-bug']) },
  }])
  await f.replay()
  equal(await count(f.g, 'fixer'), 2)
  ok((await f.g.get([taskEid(bug)]))[0].claim)
  f.close()
})
let nativeCooling = await nativeCase(true, true)
await put(nativeCooling.f.g, [{
  entity: { eid: taskEid(bug) },
  task: {},
  completed: { at: '2026-10-01T00:00:00Z' },
}])
await put(nativeCooling.f.tracker, [{
  entity: { eid: bug },
  regressed: { at: '2026-10-02T00:00:00Z' },
}])
test('a stopped native fixer still cools down its regressed bug', async () => {
  let { f } = nativeCooling
  await f.replay()
  equal(await count(f.g, 'fixer'), 1)
  ok((await f.g.get([taskEid(bug)]))[0].completed)
  f.close()
})
for (let ended of [false, true]) {
  let { f, holder } = await nativeCase(ended)
  await put(f.g, [{
    entity: { eid: taskEid(bug) },
    task: {},
    claim: { session: holder },
  }])
  test(`a ${ended ? 'stopped' : 'running'} native holder ${ended ? 'does not mark' : 'marks'} its bug taken`, async () => {
    await f.replay()
    equal(!!(await f.tracker.get([bug]))[0].taken, !ended)
    f.close()
  })
}

let settledCase = async () => {
  let result = await nativeCase(false, true)
  let { f, holder } = result
  await put(f.g, [
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: holder },
      output: {},
      content: { body: 'The turn is done, but the bug is not resolved.' },
    },
    {
      entity: { eid: taskEid(bug) },
      task: {},
      doc: { title: 'Fix tracker bug' },
    },
  ])
  return result
}
let nativeSettled = await settledCase()
test('a settled native fixer continues the same session and reclaims its released task', async () => {
  let { f, holder } = nativeSettled
  let before = await count(f.g, 'entry')
  await f.replay()
  equal(await count(f.g, 'fixer'), 1)
  equal(await count(f.g, 'entry'), before + 1)
  equal(comp((await f.g.get([taskEid(bug)]))[0], 'claim').session, holder)
  let last = (await rows(f.g, 'entry')).at(-1)!
  equal(comp(last, 'entry').session, holder)
  equal(comp(last, 'using').provider, provider)
  equal(comp(last, 'using').model, model)
  ok(
    String(comp(last, 'content').body).includes(
      'continue until it is resolved',
    ),
  )
  // Its pending next turn prevents a second continuation on replay.
  await f.replay()
  equal(await count(f.g, 'entry'), before + 1)
  f.close()
})
let resolvedSettled = await settledCase()
await put(resolvedSettled.f.tracker, [{
  entity: { eid: bug },
  resolved: { at: '2026-10-02T00:00:10Z' },
}])
test('a resolved tracker bug never continues its settled native fixer', async () => {
  let { f } = resolvedSettled
  let before = await count(f.g, 'entry')
  await f.replay()
  equal(await count(f.g, 'entry'), before)
  ok((await f.g.get([taskEid(bug)]))[0].completed)
  f.close()
})
for (
  let gate of [
    'ended',
    'stop',
    'completed',
    'cancelled',
    'claimed',
    'cap',
    'failed',
    'managed',
    'nofix',
  ]
) {
  let { f, holder } = await settledCase()
  if (gate == 'managed') {
    await put(f.g, [{ entity: { eid: holder }, native: null }])
  }
  if (gate == 'nofix') await put(f.g, [{ entity: { eid: project }, nofix: {} }])
  if (gate == 'ended') {
    await put(f.g, [{ entity: { eid: holder }, session: { ended: true } }])
  }
  if (gate == 'stop') await put(f.g, [{ entity: { eid: holder }, stop: {} }])
  if (gate == 'completed' || gate == 'cancelled') {
    await put(f.g, [{ entity: { eid: taskEid(bug) }, [gate]: {} }])
  }
  if (gate == 'claimed') {
    await put(f.g, [
      { entity: { eid: 'other-session' }, session: {} },
      { entity: { eid: taskEid(bug) }, claim: { session: 'other-session' } },
    ])
  }
  if (gate == 'cap') {
    await put(f.g, [{
      entity: { eid: 'other-session' },
      session: {},
      fixer: { bug: identityEid('bug', ['other-bug']) },
      process: { pid: 1 },
    }])
  }
  if (gate == 'failed') {
    await put(f.g, [{
      entity: { eid: crypto.randomUUID() },
      entry: { session: holder },
      exception: {},
    }])
  }
  test(`a settled native fixer does not continue past ${gate}`, async () => {
    let before = await count(f.g, 'entry')
    await f.replay()
    equal(await count(f.g, 'entry'), before)
    equal(await count(f.g, 'fixer'), gate == 'cap' ? 2 : 1)
    f.close()
  })
}

for (let changed of ['claim', 'completed', 'cancelled']) {
  let { f, holder } = await settledCase()
  let [task] = await f.g.get([taskEid(bug)])
  let { fix } = fixing(f.g, f.config)
  if (changed == 'claim') {
    await put(f.g, [{ entity: { eid: 'racing-worker' }, session: {} }])
  }
  test(`a native continuation loses a ${changed} race without appending input`, async () => {
    let before = await count(f.g, 'entry')
    await throws(() =>
      fix(async () => {
        await put(f.g, [{
          entity: task.entity,
          [changed]: changed == 'claim' ? { session: 'racing-worker' } : {},
        }])
        return { task, bug, last: 'Resolve the bug explained.' }
      }), changed == 'claim' ? 'claim.session' : `${changed}.at`)
    equal(await count(f.g, 'entry'), before)
    equal(await count(f.g, 'fixer'), 1)
    let [after] = await f.g.get([taskEid(bug)])
    if (changed == 'claim') equal(comp(after, 'claim').session, 'racing-worker')
    else ok(after[changed])
    ok(!(await f.g.get([holder]))[0].exit)
    f.close()
  })
}
