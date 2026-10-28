// The follower reads a separate RAM tracker and writes a RAM box with no bug
// vocabulary or spawn handlers. Tests observe committed requests, never agents.

import { clock, equal, ok, test, throws } from '@yaks/testing'
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
import { provenanceDoc } from '@yaks/provenance'
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
import { HARNESS } from '@yaks/harness/default'
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
// One bug reconciled in a pass of its own.
let alone = (g: Graph, options?: Options) => {
  let pass = follow(g, options)
  return async (
    row: Bundle,
    at: string,
    mutate: Parameters<typeof pass>[2],
  ) => (await pass([row], at, mutate))(row)
}
let pick = (doc: VocabDoc, ...names: string[]): VocabDoc => ({
  $defs: Object.fromEntries(names.map((name) => [name, doc.$defs![name]])),
})
let vocab = loadVocab([
  pick(kernelDoc, 'entity', 'completed', 'about'),
  pick(provenanceDoc, 'created'),
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
  pick(kernelDoc, 'entity', 'resolved', 'archived'),
  pick(provenanceDoc, 'created'),
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
// A tracker's door over a RAM tracker graph: its open bugs, its marks, and
// its bugs read by id.
let door = (tracker: Graph, seen: ReturnType<typeof watches>) =>
  Object.assign(seen.watch('.bug.status=open ?doc ?regressed ?taken'), {
    mutate: (rows: Bundle[]) => tracker.apply(rows, { trusted: true }),
    get: async (eids: string[]) =>
      (await tracker.get(eids)).filter((row) => row.bug),
  })
let trackerGraph = (unstamped = false) => {
  let schema = unstamped ? bareTrackerVocab : trackerVocab
  return graph({
    vocab: schema,
    storage: ram(schema, { computed }),
    clock: clock(Date.parse('2026-10-02T00:00:10Z')),
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
    { entity: { eid: HARNESS }, using: { provider, model } },
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
    project,
    effort: 'high',
    trackers: [url],
    open: () => door(tracker, seen),
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
  let reconcile = alone(g, config)
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
// Fixers switched off on the home project: the follower files and marks only.
let off = async (options: Options = {}, unstamped = false) => {
  let f = await fixture(options, unstamped)
  await put(f.g, [{ entity: { eid: project }, nofix: {} }])
  f.commits.length = 0
  return f
}

let fresh = await fixture({}, true)
let [freshBug] = await fresh.tracker.get([bug])
let fileFresh = alone(fresh.g, fresh.config)
await fileFresh(freshBug, url, (rows) => put(fresh.tracker, rows))
let freshWritten = await fresh.g.get(
  fresh.commits[0].map((row) => row.entity.eid),
)
test('the tracker follower files task, evidence edge and fixer atomically', async () => {
  let { tracker, commits } = fresh
  equal(commits.length, 1)
  let written = freshWritten
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
let refusing = alone(unmarked.g, unmarked.config)
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

for (let gate of ['nofix', 'cap', 'cooldown']) {
  let f = await fixture(gate == 'cap' ? { cap: 0 } : {})
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

let retry = await off({}, true)
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

let flood = await off()
let gone = [1, 2, 3].map((n) => identityEid('bug', [`gone ${n}`]))
await put(
  flood.tracker,
  gone.map((eid, i) => ({
    entity: { eid },
    bug: { fault: eid, hits: 1, last: '2026-10-02T00:00:01Z' },
    doc: { title: 'Gone' },
    ...i == 0 ? {} : { resolved: {} },
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
test('occurrence-only hits replay no unchanged work, and closed bugs cost no read', () => {
  equal(gone.map(asked), [2, 0, 0])
  equal(asked(bug), 2)
})

let outage = await off()
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
  let f = await off({}, unstamped)
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
  // A read by id through the API, its frames delivered as they come.
  let ask = async (eids: string[]) => {
    let done = false
    let answer = watch.get(eids).finally(() => done = true)
    for (let i = 0; !done && i < 100; i++) {
      while (frames.length) frames.shift()!()
      await Promise.resolve()
    }
    return answer
  }
  await ready()
  return {
    ...f,
    watch,
    ready,
    ask,
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
reconnected.reconnect()
await reconnected.ready()
let [reconnectResolved] = await reconnected.ask([bug])
reconnected.watch.close()
reconnected.close()
test('the headless tracker reconnect replaces stale query membership', () => {
  equal(reconnectMembers.map((row) => row.entity.eid), [replacement])
  equal(reconnected.watch.value.map((row) => row.entity.eid), [replacement])
})
test('a bug resolved while disconnected is read by id with its mark', () => {
  ok(reconnectResolved.resolved)
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
  let [row] = await f.ask([bug])
  test(`a tracker ${bugMark} bug leaves the headless answer, and its mark read by id closes its task`, async () => {
    equal(f.watch.value, [])
    ok(row[bugMark])
    await alone(f.g)(row, url, f.watch.mutate)
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

let archiveDone = await off()
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

let closeRetry = await off()
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
  ok(!(await trackerCycle.g.get([taskEid(bug)]))[0].completed)
  equal(await count(trackerCycle.g, 'task'), 1)
  equal(await count(trackerCycle.g, 'fixer'), 2)
})
test('replaying a reopened regression does not file another fixer', async () => {
  await trackerCycle.replay()
  equal(await count(trackerCycle.g, 'task'), 1)
  equal(await count(trackerCycle.g, 'fixer'), 2)
  trackerCycle.close()
})

// Terminal work is the durable receipt for a tracker mark, across service runs.
let finished = async (mark: string) => {
  let f = await off()
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

// A bug resolved after its work was filed: between two passes of one
// follower, or while none ran. Either way the follower reads it by id.
for (let between of [true, false]) {
  let f = await off()
  let resolve = () =>
    put(f.tracker, [{
      entity: { eid: bug },
      resolved: { at: '2026-10-02T00:00:02Z' },
    }])
  if (!between) await f.run().then(resolve)
  let stop = new AbortController(), waits = 0
  let task = async () => (await f.g.get([taskEid(bug)]))[0]
  await service(f.host, {
    ...f.config,
    // The tracker's answer moves a moment after the write: pass until then.
    wait: async () => {
      if (between && ++waits == 1) await resolve()
      else if (!between || waits > 20 || (await task()).completed) stop.abort()
    },
  }, stop.signal)
  let [completed] = [comp(await task(), 'completed')]
  f.close()
  test(`a bug resolved ${between ? 'between passes' : 'while no follower ran'} completes its work`, () => {
    equal(completed?.at, '2026-10-02T00:00:02Z')
  })
}

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
        ...door(emptyTracker, emptySeen),
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
  alone(transport.g)(transportBug, url, (rows, opts) => {
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
  () => alone(lost.g)(lostBug, url, lost.watch.mutate),
  'acknowledgement lost',
)
await lost.ready()
lost.trackerCommits.length = 0
lost.lose(false)
await alone(lost.g)(lostBug, url, lost.watch.mutate)
test('a lost tracker acknowledgement replays without another write', async () => {
  ok((await lost.tracker.get([bug]))[0].archived)
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
      alone(raced.g)(
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

let ordered = await off()
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
  let f = await off({ trackers })
  let [row] = await f.tracker.get([bug])
  let reconcile = alone(f.g, f.config)
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

let held = await off()
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
          get: () => Promise.resolve([]),
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
let { f: stoppedFixture } = nativeStopped
await put(stoppedFixture.g, [{
  entity: { eid: nativeStopped.holder },
  fixer: { bug: identityEid('bug', ['another-bug']) },
}])
await stoppedFixture.replay()
let stoppedCount = await count(stoppedFixture.g, 'fixer')
let [stoppedTask] = await stoppedFixture.g.get([taskEid(bug)])
test('a stopped native transcript releases the fixer cap without an exit', () => {
  equal(stoppedCount, 2)
  ok(stoppedTask.claim)
  stoppedFixture.close()
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
  let { f, holder } = await nativeCase(ended, true)
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
let continuedScenario = await (async () => {
  try {
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
        'continue until its cause is fixed and live',
      ),
    )
    // Its pending next turn prevents a second continuation on replay.
    await f.replay()
    equal(await count(f.g, 'entry'), before + 1)
    f.close()

    return undefined
  } catch (error) {
    return error
  }
})()
test('a settled native fixer continues the same session and reclaims its released task', () => {
  if (continuedScenario) throw continuedScenario
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
    'cancelled',
    'claimed',
    'cap',
    'managed',
    'nofix',
  ]
) {
  let { f, holder } = await settledCase()
  if (gate == 'managed') {
    await put(f.g, [{ entity: { eid: holder }, native: null }])
  }
  if (gate == 'nofix') await put(f.g, [{ entity: { eid: project }, nofix: {} }])
  if (gate == 'cancelled') {
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
  let { fix } = fixing(f.g, f.config)([bug])
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

// Completion belongs to the tracker: a local completion cannot strand an open
// bug, even when no newer regression was recorded.
let completedNative = await settledCase()
await put(completedNative.f.g, [{
  entity: { eid: taskEid(bug) },
  completed: {},
  claim: { session: completedNative.holder },
}])
let completedScenario = await (async () => {
  try {
    let { f, holder } = completedNative
    let before = await count(f.g, 'entry')
    await f.replay()
    equal(await count(f.g, 'entry'), before + 1)
    equal(await count(f.g, 'fixer'), 1)
    let [task] = await f.g.get([taskEid(bug)])
    ok(!task.completed)
    equal(comp(task, 'claim').session, holder)
    await f.replay()
    equal(await count(f.g, 'entry'), before + 1)
    f.close()

    return undefined
  } catch (error) {
    return error
  }
})()
test('completed-open native work continues atomically without a regression', () => {
  if (completedScenario) throw completedScenario
})
for (let completed of [false, true]) {
  let { f, holder } = await settledCase()
  await put(f.g, [
    {
      entity: { eid: holder },
      native: null,
      session: { ended: true },
      exit: { code: 0 },
      created: { at: '2026-01-01T00:00:00Z' },
    },
    {
      entity: { eid: taskEid(bug) },
      claim: { session: holder },
      ...(completed ? { completed: {} } : {}),
    },
  ])
  await f.replay()
  let first = await count(f.g, 'fixer')
  let [task] = await f.g.get([taskEid(bug)])
  await f.replay()
  let replayed = await count(f.g, 'fixer')
  test(`exited managed history retries ${completed ? 'completed' : 'open'} work once after cooldown`, () => {
    equal(first, 2)
    ok(!task.completed)
    ok(comp(task, 'claim').session != holder)
    equal(replayed, 2)
    f.close()
  })
}

for (let stale of [false, true]) {
  let { f, holder } = await settledCase()
  await put(f.g, [
    {
      entity: { eid: 'foreign' },
      session: {},
      process: { pid: 1 },
      ...(stale ? { exit: { code: 0 } } : {}),
    },
    {
      entity: { eid: taskEid(bug) },
      claim: { session: 'foreign' },
      completed: {},
    },
  ])
  test(`${stale ? 'stale' : 'live'} foreign claims ${stale ? 'release' : 'hold'} completed-open native work`, async () => {
    let before = await count(f.g, 'entry')
    await f.replay()
    equal(await count(f.g, 'entry'), before + (stale ? 1 : 0))
    let [task] = await f.g.get([taskEid(bug)])
    equal(comp(task, 'claim').session, stale ? holder : 'foreign')
    equal(!!task.completed, !stale)
    f.close()
  })
}

let managedCooling = await settledCase()
await put(managedCooling.f.g, [
  { entity: { eid: managedCooling.holder }, native: null, exit: { code: 0 } },
  {
    entity: { eid: taskEid(bug) },
    completed: {},
    claim: { session: managedCooling.holder },
  },
])
test('exited managed continuation retains cooldown and local completion while held', async () => {
  let { f } = managedCooling
  let before = await count(f.g, 'entry')
  await f.replay()
  equal(await count(f.g, 'entry'), before)
  equal(await count(f.g, 'fixer'), 1)
  ok((await f.g.get([taskEid(bug)]))[0].completed)
  f.close()
})

// A managed transcript can already be settled while its process is still
// running. That foreign worker's claim is not a stale native-turn claim.
for (let managed of [false, true]) {
  for (let stale of [false, true]) {
    let { f, holder } = await settledCase()
    await put(f.g, [
      ...(managed
        ? [{
          entity: { eid: holder },
          native: null,
          exit: { code: 0 },
          created: { at: '2026-01-01T00:00:00Z' },
        }]
        : []),
      {
        entity: { eid: 'foreign-managed' },
        session: {},
        process: { pid: 1 },
        ...(stale ? { exit: { code: 0 } } : {}),
      },
      {
        entity: { eid: 'foreign-output' },
        entry: { session: 'foreign-managed' },
        output: {},
      },
      { entity: { eid: taskEid(bug) }, claim: { session: 'foreign-managed' } },
    ])
    test(`${managed ? 'managed retry' : 'native continuation'} ${stale ? 'reclaims exited' : 'preserves live'} foreign managed claims`, async () => {
      let before = await count(f.g, 'entry')
      await f.replay()
      equal(await count(f.g, 'entry'), before + (stale ? 1 : 0))
      equal(await count(f.g, 'fixer'), managed && stale ? 2 : 1)
      let [task] = await f.g.get([taskEid(bug)])
      equal(comp(task, 'claim').session == 'foreign-managed', !stale)
      f.close()
    })
  }
}

for (let closed of ['resolved', 'archived']) {
  let { f, holder } = await settledCase()
  await f.replay()
  await put(f.g, [{
    entity: { eid: 'another-settled-turn' },
    entry: { session: holder },
    output: {},
  }])
  await put(f.tracker, [{ entity: { eid: bug }, [closed]: {} }])
  test(`tracker ${closed} stops subsequent continuation`, async () => {
    let before = await count(f.g, 'entry')
    await f.replay()
    await f.replay()
    equal(await count(f.g, 'entry'), before)
    equal(await count(f.g, 'fixer'), 1)
    ok(
      (await f.g.get([taskEid(bug)]))[0][
        closed == 'resolved' ? 'completed' : 'cancelled'
      ],
    )
    f.close()
  })
}

// A terminal transcript is never resumed, but its open bug still needs work.
for (let terminal of ['ended', 'stop', 'failed']) {
  for (let recent of [false, true]) {
    let { f, holder } = await settledCase()
    await put(f.g, [{
      entity: { eid: holder },
      created: {
        at: recent ? new Date().toISOString() : '2026-01-01T00:00:00Z',
      },
      ...(terminal == 'ended' ? { session: { ended: true } } : {}),
      ...(terminal == 'stop' ? { stop: {} } : {}),
    }, {
      entity: { eid: taskEid(bug) },
      completed: {},
      claim: { session: holder },
    }])
    if (terminal == 'failed') {
      await put(f.g, [{
        entity: { eid: 'failed-turn' },
        entry: { session: holder },
        exception: {},
      }])
    }
    let before = await count(f.g, 'entry')
    let [original] = await f.g.get([holder])
    await f.replay()
    let after = await count(f.g, 'entry')
    let [task] = await f.g.get([taskEid(bug)])
    let [old] = await f.g.get([holder])
    await f.replay()
    let fixers = await count(f.g, 'fixer')
    test(`${terminal} native fixer ${recent ? 'cools down' : 'gets a replacement for its open bug'}`, () => {
      equal(after, before + (recent ? 0 : 1))
      equal(fixers, recent ? 1 : 2)
      equal(comp(task, 'claim').session == holder, recent)
      equal(!!task.completed, recent)
      equal(old, original)
      f.close()
    })
  }
}

for (let source of [url, 'yaks.app']) {
  let f = await fixture({ cli: 'yak --config /srv/tracker.json' })
  let [evidence] = await f.tracker.get([bug])
  let reconcile = alone(f.g, f.config)
  test(`${source == url ? 'local' : 'platform'} fixer instructions target their authoritative tracker`, async () => {
    await reconcile(evidence, source, (rows) => put(f.tracker, rows))
    let [entry] = await rows(f.g, 'entry')
    let body = String(comp(entry, 'content').body)
    let command = `env -u YAKS_HOST yak --config /srv/tracker.json bug`
    let suffix = source == 'yaks.app' ? ' --source yaks.app' : ''
    ok(body.includes(`${command} resolve ${bug}${suffix} --broke`))
    ok(body.includes(`${command} show ${bug}${suffix}`))
    equal(body.includes('--source yaks.app'), source == 'yaks.app')
    ok(body.includes(source))
    f.close()
  })
}

// A manually claimed native task need not wear fixer history. Its completed
// local task is not proof that the authoritative tracker was resolved.
let untagged = await settledCase()
await put(untagged.f.g, [
  { entity: { eid: untagged.holder }, fixer: null },
  {
    entity: { eid: taskEid(bug) },
    completed: {},
    claim: { session: untagged.holder },
  },
])
await untagged.f.replay()
let untaggedFixers = await rows(untagged.f.g, 'fixer')
let [untaggedTask] = await untagged.f.g.get([taskEid(bug)])
await untagged.f.replay()
let untaggedReplayed = await count(untagged.f.g, 'fixer')
test('completed task held by an untagged settled native session gets one tracker fixer', () => {
  equal(untaggedFixers.length, 1)
  ok(untaggedFixers[0].entity.eid != untagged.holder)
  equal(comp(untaggedTask, 'claim').session, untaggedFixers[0].entity.eid)
  ok(!untaggedTask.completed)
  equal(untaggedReplayed, 1)
  untagged.f.close()
})

let alreadyTaken = await fixture({ cap: 1 })
await alreadyTaken.run()
let takenTask = (await rows(alreadyTaken.g, 'task'))[0]
let takenHolder = String(comp(takenTask, 'claim').session)
let getTaken = alreadyTaken.g.get
alreadyTaken.g.get = (ids, comps, options) => {
  if (ids.includes(takenHolder) && comps === undefined) {
    throw new Error('an already reported opening does not need fixer status')
  }
  return getTaken(ids, comps, options)
}
test('a replay of a taken opening does not read the holder transcript', async () => {
  await alreadyTaken.replay()
  equal(!!(await alreadyTaken.tracker.get([bug]))[0].taken, true)
  alreadyTaken.close()
})

let guardGuardCooled = await fixture({ cap: 1, cooldown: 1e12 })
let guardGuardCooledHolder = crypto.randomUUID()
await put(guardGuardCooled.g, [{
  entity: { eid: guardGuardCooledHolder },
  fixer: { bug },
  created: { at: new Date().toISOString() },
}])
let readGuardCooled = guardGuardCooled.g.read
guardGuardCooled.g.read = (query, options) => {
  if (
    typeof query == 'object' &&
    JSON.stringify(query).includes('"path":["fixer"]') &&
    JSON.stringify(query).includes('"path":["exit"]')
  ) {
    throw new Error('cooldown does not need a global fixer capacity read')
  }
  return readGuardCooled(query, options)
}
test('cooldown refuses a new fixer before reading global capacity', async () => {
  await guardGuardCooled.run()
  guardGuardCooled.g.read = readGuardCooled
  equal((await rows(guardGuardCooled.g, 'fixer')).length, 1)
  equal(guardGuardCooled.errors, [])
  guardGuardCooled.close()
})

// A managed fixer's slot never needs the status of its transcript. Keep that
// projection unavailable while ordinary reads and writes remain real.
let managedStatus = await fixture({ cap: 1 })
let otherFault = crypto.randomUUID()
await put(managedStatus.g, [{
  entity: { eid: otherFault },
  doc: { title: 'Other fault' },
}, {
  entity: { eid: 'managed-status-holder' },
  fixer: { bug: otherFault },
  session: {},
  process: { pid: 42 },
}])
let managedStatusRead = managedStatus.g.read.bind(managedStatus.g)
managedStatus.g.read = (query, options) => {
  let q = JSON.stringify(query)
  if (q.includes('status') && q.includes('session')) {
    throw new Error('managed fixer inspected transcript status')
  }
  return managedStatusRead(query, options)
}
test('a managed fixer fills capacity without deriving any transcript status', async () => {
  await managedStatus.replay()
  equal(await count(managedStatus.g, 'fixer'), 1)
  equal(await count(managedStatus.g, 'task'), 1)
  managedStatus.close()
})

// Bugs standing in each state a whole pass meets: open work held by a running
// fixer or waiting at the cap, and closed work completed or cancelled. Then
// one more whole pass, with every box read it makes counted.
let standing = async (open: number, closed: number) => {
  let f = await fixture()
  let bugs = (kind: string, n: number) =>
    Array.from({ length: n }, (_, i) => identityEid('bug', [`${kind} ${i}`]))
  let report = (eids: string[]) =>
    put(
      f.tracker,
      eids.map((eid) => ({
        entity: { eid },
        bug: { fault: eid, hits: 1, last: '2026-10-02T00:00:01Z' },
        doc: { title: eid },
      })),
    )
  let shut = bugs('closed', closed)
  await report(bugs('open', open - 1))
  await f.run()
  await report(shut)
  await f.run()
  await put(
    f.tracker,
    shut.map((eid, i) => ({
      entity: { eid },
      [i % 2 ? 'archived' : 'resolved']: {},
    })),
  )
  await f.run()
  let { read, get, address } = f.g
  let reads = 0
  f.g.read = (...args) => (reads++, read(...args))
  f.g.get = (...args) => (reads++, get(...args))
  f.g.address = (...args) => (reads++, address(...args))
  f.commits.length = f.trackerCommits.length = 0
  await f.run()
  Object.assign(f.g, { read, get, address })
  let found = {
    reads,
    writes: [...f.commits, ...f.trackerCommits],
    tasks: await count(f.g, 'task'),
    fixers: await count(f.g, 'fixer'),
    taken: (await f.tracker.read(and(present('taken')))).length,
    closed: await count(f.g, 'completed') + await count(f.g, 'cancelled'),
  }
  f.close()
  return found
}
let few = await standing(3, 2)
let many = await standing(9, 8)
test('a whole pass reads every bug it follows at once', () => {
  let { reads } = few
  equal(few, { reads, writes: [], tasks: 5, fixers: 2, taken: 2, closed: 2 })
  equal(many, { reads, writes: [], tasks: 17, fixers: 2, taken: 2, closed: 8 })
})

// The Sessions switch uses this same graph mark; pending work survives off/on.
let switched = await (async () => {
  let f = await fixture({ cooldown: 0 })
  await put(f.g, [{ entity: { eid: project }, nofix: {} }])
  await f.run()
  let paused = {
    tasks: await count(f.g, 'task'),
    fixers: await count(f.g, 'fixer'),
    entries: await count(f.g, 'entry'),
  }
  await put(f.g, [{ entity: { eid: project }, nofix: null }])
  await f.replay()
  let resumed = {
    tasks: await count(f.g, 'task'),
    fixers: await count(f.g, 'fixer'),
    entries: await count(f.g, 'entry'),
  }
  f.close()
  return { paused, resumed }
})()
test('unmuting the home project resumes pending bugs without duplicating work', () => {
  equal(switched.paused, { tasks: 1, fixers: 0, entries: 0 })
  equal(switched.resumed, { tasks: 1, fixers: 1, entries: 1 })
})
