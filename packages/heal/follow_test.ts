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
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { modelDoc } from '@yaks/model'
import { processDoc } from '@yaks/process'
import { watches } from '@yaks/client'
import { api, subscriptions } from '@yaks/api'
import { and, every, present } from '@yaks/query'
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
  pick(notifyDoc, 'knock'),
], [kernelKeywords, edgeKeywords])

let trackerVocab = loadVocab([
  archetypeDoc,
  pick(
    kernelDoc,
    'entity',
    'created',
    'updated',
    'resolved',
    'archived',
  ),
  pick(docDoc, 'doc'),
  pick(trackerDoc, 'bug', 'error', 'during', 'regressed', 'taken'),
  pick(mailDoc, 'notified'),
], [kernelKeywords])
let trackerGraph = () =>
  graph({
    vocab: trackerVocab,
    storage: ram(trackerVocab, { computed }),
    plugins: [archetypes()],
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
  let watch = track(url, {
    fetch: async (request) => {
      if (unavailable) throw new Error('tracker is down')
      if (new URL(request.url).pathname == '/apply') posts++
      let answer = await handler(request)
      if (lose) throw new Error('acknowledgement lost')
      return answer
    },
    connect: () => {
      let halves = next
      // A socket delivers in a later turn, independently of the HTTP response.
      // Queue frames so an /apply test does not also time its socket echo.
      let send = halves.server.send
      halves.server.send = (data) => frames.push(() => send(data))
      socket = halves.client
      pending.push(halves.server)
      opened = Promise.resolve(handler(request)).then(() => {
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
    drop: () => {
      socket.close()
      next = pair()
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

let down = await finished('completed')
down.breakTracker(true)
test('a tracker down at its owed mark reports the failure and writes nothing', async () => {
  await down.run()
  equal(down.errors.length, 1)
  equal(down.trackerCommits, [])
  ok(!(await down.tracker.get([bug]))[0].resolved)
  down.close()
})

let markRetry = await finished('completed')
markRetry.breakTracker(true)
await markRetry.run()
markRetry.breakTracker(false)
test('an owed tracker mark survives downtime and a follower restart', async () => {
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
await cycle.replay()
let [reopened] = await cycle.g.get([taskEid(bug)])
test('work reopened by a regression resolves on its next completion', async () => {
  await put(cycle.g, [{
    entity: reopened.entity,
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

// What the service opens when the platform is followed, and the body of the
// platform bug's task. The store is set up here; the pass is the timed part.
let platform = async (trackers: string[]) => {
  let f = await fixture({ trackers, provider: undefined })
  let opened: string[] = []
  return async () => {
    await service(f.host, {
      ...f.config,
      remote: { url: 'https://tracker.example' },
      open: (at) => {
        opened.push(at)
        return f.config.open!(at)
      },
    })
    let [task] = await f.g.get([taskEid(bug)])
    f.close()
    return { opened, body: String(comp(task, 'doc').body) }
  }
}

let withWeb = await platform([url])
test('the platform tracker is followed first, its task linking its page on the tracker web', async () => {
  let { opened, body } = await withWeb()
  equal(opened, ['yaks.app', url])
  ok(body.includes(`(${url}/?q=.bug&side=yaks.app&bug=${bug})`))
})

let noWeb = await platform([])
test("with no tracker web, a platform bug's task names the command that reads it", async () => {
  let { body } = await noWeb()
  ok(body.includes(`yak bug show ${bug} --source yaks.app`))
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
