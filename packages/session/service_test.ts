import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Comp, type Graph, identityEid } from '@yaks/graph'
import { ids, locked, lockOn, seed, store } from './testing.ts'
import { BATCH, look, type Seen, service, stale, strip } from './service.ts'
import { fileOf } from '@yaks/file'
import { onDisk } from '@yaks/file/local'
import { callOf } from './tail.ts'
import { sessionEid, subagentSession } from './who.ts'

let lines = (...texts: string[]) =>
  texts.flatMap((text, i) => [
    { type: 'user', origin: { kind: 'human' }, message: { content: text } },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', thinking: `thought ${i}` }, {
          type: 'text',
          text: `said ${i}`,
        }],
      },
    },
  ]).map((l) => JSON.stringify(l)).join('\n') + '\n'

let tool = [
  {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
    },
  },
  {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }],
    },
  },
].map((l) => JSON.stringify(l)).join('\n') + '\n'

// A transcript whose every line says it was written `ago` milliseconds back.
let dated = (text: string, ago: number) =>
  text.trim().split('\n').map((l) =>
    JSON.stringify({
      ...JSON.parse(l),
      timestamp: new Date(Date.now() - ago).toISOString(),
    })
  ).join('\n') + '\n'

// A subagent's transcript: every line a side conversation.
let side = (text: string) =>
  text.trim().split('\n').map((l) =>
    JSON.stringify({ ...JSON.parse(l), isSidechain: true })
  ).join('\n') + '\n'

// A Claude projects directory holding one transcript per name, a session's id
// or `<session>/subagents/agent-<id>`, each last written `ago` milliseconds
// before now.
let projectFiles = (files: Record<string, { text: string; ago?: number }>) => {
  let dir = Deno.makeTempDirSync()
  for (let [name, f] of Object.entries(files)) {
    let path = `${dir}/-home-me-code/${name}.jsonl`
    Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    Deno.writeTextFileSync(path, f.text)
    let at = new Date(Date.now() - (f.ago ?? 0))
    Deno.utimeSync(path, at, at)
  }
  return dir
}

let projects = async (
  files: Record<string, { text: string; ago?: number }>,
  body: (dir: string) => Promise<void>,
) => {
  let dir = projectFiles(files)
  try {
    await body(dir)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

let told = async (g: Graph, id: string) => {
  let [s] = await g.read(`.session.id=${id}`)
  if (!s) return undefined
  return (await g.read(`.entry.session=${s.entity.eid}&.order=entry.seq&*`))
    .map((b) => (b.content as { body: string } | undefined)?.body ?? '(call)')
}

let DAY = 24 * 60 * 60 * 1000

let reapStore = store()
seed(reapStore, { entity: { eid: ids.p2 }, claim: { session: ids.gone } })
let reapGraph = locked(reapStore)

test('the duty frees the locks whose holder is gone as it starts', async () => {
  await service({ graph: reapGraph }, {}, AbortSignal.abort())
  assertEquals(lockOn(reapStore, ids.p2), undefined)
})

test('a recent transcript is followed in full; an old one is read in later, its prose alone', () =>
  projects({
    one: { text: lines('fix it') },
    fresh: { text: lines('hello') },
    old: { text: lines('long ago'), ago: 30 * DAY },
  }, async (dir) => {
    let g = locked(store())
    let seen: Seen = { tails: new Map(), done: new Set() }
    await look(g, dir, seen, { person: ids.ada })
    assertEquals(await told(g, 'one'), ['fix it', 'thought 0', 'said 0'])
    assertEquals(await told(g, 'fresh'), ['hello', 'thought 0', 'said 0'])
    // One old transcript per look, and its prose alone.
    assertEquals(await told(g, 'old'), ['long ago', 'said 0'])
    // What a session says next is read on from where it stood.
    Deno.writeTextFileSync(`${dir}/-home-me-code/one.jsonl`, lines('more'), {
      append: true,
    })
    await look(g, dir, seen)
    assertEquals(await told(g, 'one'), [
      'fix it',
      'thought 0',
      'said 0',
      'more',
      'thought 0',
      'said 0',
    ])
  }))

let fairness: {
  first: (string[] | undefined)[]
  last: (string[] | undefined)[]
}
await projects({
  long: { text: lines('a', 'b', 'c'), ago: 1000 },
  live: { text: lines('hi') },
  old: { text: lines('x', 'y'), ago: 30 * DAY },
}, async (dir) => {
  let g = locked(store()), seen: Seen = { tails: new Map(), done: new Set() }
  let once = () => look(g, dir, seen, { slice: 0, budget: 0 })
  for (let i = 0; i < 3; i++) await once()
  let first = await Promise.all(
    ['live', 'long', 'old'].map((id) => told(g, id)),
  )
  for (let i = 0; i < 18; i++) {
    Deno.writeTextFileSync(`${dir}/-home-me-code/live.jsonl`, lines('more'), {
      append: true,
    })
    await once()
  }
  fairness = {
    first,
    last: await Promise.all(['long', 'old'].map((id) => told(g, id))),
  }
})

test('bounded looks advance every source while another transcript keeps growing', () => {
  assertEquals(fairness.first, [['hi'], ['a'], ['x']])
  assertEquals(fairness.last[0]?.length, 9)
  assertEquals(fairness.last[1], ['x', 'said 0', 'y', 'said 1'])
})

let waiting: string[] | undefined
await projects({
  waiting: { text: lines('waiting'), ago: 1000 },
  live: { text: lines('live') },
}, async (dir) => {
  let g = locked(store()), seen: Seen = { tails: new Map(), done: new Set() }
  for (let i = 0; i < 4; i++) {
    let path = `${dir}/-home-me-code/old-${i}.jsonl`
    Deno.writeTextFileSync(path, lines('old').split('\n')[0] + '\n')
    Deno.utimeSync(path, new Date(0), new Date(0))
    await look(g, dir, seen, { slice: 0, budget: 0 })
  }
  waiting = await told(g, 'waiting')
})

test('new historical files join behind a source already waiting for its turn', () => {
  assertEquals(waiting?.[0], 'waiting')
})

let coldChildCall: unknown
await projects({
  parent: { text: tool },
  'parent/subagents/agent-child': {
    text: side(lines('child input')),
    ago: 1000,
  },
}, async (dir) => {
  Deno.writeTextFileSync(
    `${dir}/-home-me-code/parent/subagents/agent-child.meta.json`,
    JSON.stringify({ toolUseId: 't1' }),
  )
  let g = locked(store())
  await look(g, dir, { tails: new Map(), done: new Set() })
  let [child] = await g.get([sessionEid('child', 'parent')])
  coldChildCall = (child.spawned as Comp)?.call
})

test('a cold child still names its parent call when the parent file is newer', () => {
  assertEquals(coldChildCall, callOf(sessionEid('parent'), 't1'))
})

test('a session is the entity its harness id names', () => {
  let id = '49805559-ca98-4c0a-873e-45c19ec7316c'
  return projects({ [id]: { text: lines('hello') } }, async (dir) => {
    let g = locked(store())
    await look(g, dir, { tails: new Map(), done: new Set() })
    let [s] = await g.get([id])
    assertEquals((s.session as Comp).id, id)
    assertEquals(await told(g, id), ['hello', 'thought 0', 'said 0'])
    // The hook, writing the session its payload names, writes the same one;
    // so does a second write for an id that is not a uuid.
    let hook = (id: string) =>
      g.apply([{ entity: { eid: '$s' }, session: { id } }])
    await hook(id)
    await hook('run')
    await hook('run')
    assertEquals((await g.read(`.session.id=${id}`)).length, 1)
    assertEquals((await g.read('.session.id=run')).length, 1)
  })
})

test("a subagent's transcript is a session of its own, started by its parent's call", () => {
  let parent = '49805559-ca98-4c0a-873e-45c19ec7316c'
  let agent = `${parent}/subagents/agent-a1`
  let started = {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: {} }],
    },
  }
  let done = { type: 'assistant', message: { content: 'done' } }
  // The parent wrote the call before the subagent it started wrote anything.
  return projects({
    [parent]: { text: JSON.stringify(started) + '\n', ago: 1000 },
    [agent]: { text: side(tool) },
  }, async (dir) => {
    let at = `${dir}/-home-me-code/${agent}`
    Deno.writeTextFileSync(`${at}.meta.json`, '{"toolUseId":"toolu_a"}')
    let g = locked(store())
    let seen: Seen = { tails: new Map(), done: new Set() }
    await look(g, dir, seen)
    let [s] = await g.get([sessionEid('a1', parent)])
    assertEquals(s.spawned, { parent, call: callOf(parent, 'toolu_a') })
    assertEquals(await told(g, 'a1'), ['(call)', 'a.txt'])
    // What it does next arrives as it is written.
    Deno.writeTextFileSync(`${at}.jsonl`, side(JSON.stringify(done)), {
      append: true,
    })
    await look(g, dir, seen)
    assertEquals(await told(g, 'a1'), ['(call)', 'a.txt', 'done'])
  })
})

// A subagent the hook door wrote before its transcript was read.
let hookFirst: unknown
let hookParent = '49805559-ca98-4c0a-873e-45c19ec7316c'
await projects({
  [hookParent]: {
    text: JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_a',
          name: 'Agent',
          input: {},
        }],
      },
    }) + '\n',
    ago: 1000,
  },
  [`${hookParent}/subagents/agent-a1`]: { text: side(tool) },
}, async (dir) => {
  Deno.writeTextFileSync(
    `${dir}/-home-me-code/${hookParent}/subagents/agent-a1.meta.json`,
    '{"toolUseId":"toolu_a"}',
  )
  let g = locked(store())
  let child = await subagentSession(g, hookParent, 'a1')
  await look(g, dir, { tails: new Map(), done: new Set() })
  hookFirst = (await g.get([child!]))[0].spawned
})

test("a subagent the hook door met first gains its parent's call once read", () => {
  assertEquals(hookFirst, {
    parent: hookParent,
    call: callOf(hookParent, 'toolu_a'),
  })
})

let managedDir = projectFiles({ run1: { text: lines('asked') } })
let managedStore = store()
let managedProvider = identityEid('provider', ['claude'])
seed(managedStore, {
  entity: { eid: managedProvider },
  provider: { name: 'claude' },
}, {
  entity: { eid: 'request' },
  entry: { session: ids.run1 },
  content: { body: 'do it' },
  using: { provider: managedProvider },
})
let managedGraph = locked(managedStore)

test('a managed run is read from its own output, not its transcript file', async () => {
  try {
    await look(managedGraph, managedDir, { tails: new Map(), done: new Set() })
    assertEquals(await told(managedGraph, 'one'), ['do it'])
  } finally {
    Deno.removeSync(managedDir, { recursive: true })
  }
})

let trim = async (g: Graph, o: Parameters<typeof stale>[1] = {}) => {
  for await (let eids of stale(g, o)) await strip(g, eids)
}

let staleEntries = async (g: Graph, o: Parameters<typeof stale>[1] = {}) => {
  let eids: string[] = []
  for await (let batch of stale(g, o)) eids.push(...batch)
  return eids
}

// A reply naming its request: what it used, weighed at its model's price.
let ended = JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_1',
    model: 'priced',
    content: [],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
}) + '\n'
let priced = (s: ReturnType<typeof store>) =>
  seed(s, {
    entity: { eid: identityEid('model', ['priced']) },
    model: { name: 'priced' },
    price: { input: 1e4, output: 3e4 },
  })

test('a session quiet past its full depth is stripped to its prose and its cost', () =>
  projects({
    past: { text: dated(lines('long ago') + tool + ended, 30 * DAY) },
    'past/subagents/agent-p': { text: dated(side(tool), 30 * DAY) },
    today: { text: lines('hello') + tool },
  }, async (dir) => {
    let s = store()
    priced(s)
    let g = locked(s)
    await look(g, dir, { tails: new Map(), done: new Set() }, {
      person: ids.ada,
    })
    await trim(g)
    assertEquals(await told(g, 'past'), ['long ago', 'said 0', '(call)'])
    let [past] = await g.read('.session.id=past')
    let [spent] = await g.read(`.entry.session=${past.entity.eid}&.cost&*`)
    assertEquals(spent.cost, { dollars: 0.25, reported: false })
    assertEquals(await told(g, 'p'), [])
    assertEquals(await told(g, 'today'), [
      'hello',
      'thought 0',
      'said 0',
      '(call)',
      'a.txt',
    ])
    assertEquals(await staleEntries(g), [])
  }))

test('stripping old imports removes refusals but keeps cost-bearing refusals', async () => {
  let s = store()
  let g = locked(s)
  seed(s, {
    entity: { eid: 'refused' },
    entry: { session: ids.run1 },
    lines: { file: fileOf('disk', 'one.jsonl'), start: 1 },
    refusal: { code: 'http_400' },
    content: { body: 'invalid request' },
  }, {
    entity: { eid: 'spent-refusal' },
    entry: { session: ids.run1 },
    lines: { file: fileOf('disk', 'one.jsonl'), start: 2 },
    refusal: { code: 'limit' },
    content: { body: 'at the limit' },
    cost: { dollars: 0.25, reported: true },
  })
  let eids = await staleEntries(g, { full: 0, now: Date.now() + DAY })
  assertEquals(eids, ['refused'])
  await strip(g, eids)
  assertEquals((await g.read('.entity.eid=refused&.refusal')).length, 0)
  assertEquals((await g.get(['spent-refusal']))[0].refusal, { code: 'limit' })
})

for (let revived of [false, true]) {
  test(`retention pages survive deletion${revived ? ' and stop when a session speaks again' : ''}`, async () => {
    let s = store(), g = locked(s)
    let now = Date.now()
    let old = new Date(now - 30 * DAY).toISOString()
    let entries = Array.from({ length: BATCH + 2 }, (_, seq) => ({
      entity: { eid: `old-${String(seq).padStart(3, '0')}` },
      entry: { session: ids.run1, seq },
      lines: { file: fileOf('disk', 'old.jsonl'), start: seq + 1 },
      result: {},
      content: { body: 'old tool output' },
      created: { at: old },
    }))
    seed(s, ...entries)
    let pages = stale(g, { now })
    let first = await pages.next()
    assertEquals(first.value?.length, BATCH)
    await strip(g, first.value!)
    if (revived) {
      seed(s, {
        entity: { eid: 'recent' },
        entry: { session: ids.run1, seq: BATCH + 2 },
        content: { body: 'back again' },
        created: { at: new Date(now).toISOString() },
      })
    }
    let rest: string[] = []
    for await (let batch of pages) {
      rest.push(...batch)
      await strip(g, batch)
    }
    assertEquals(
      rest,
      revived ? [] : entries.slice(BATCH).map((b) => b.entity.eid),
    )
    assertEquals(
      (await g.rows('.lines .entry.session=run1')).length,
      revived ? 2 : 0,
    )
  })
}

let reopened = 0, opened = 0, resumed: string[] | undefined
let speaking: string[] | undefined
await projects(
  { old: { text: lines('a', 'b', 'c'), ago: 30 * DAY } },
  async (dir) => {
    let g = locked(store()), get = g.get.bind(g)
    let [file] = await onDisk(g, `${dir}/-home-me-code/old.jsonl`)
    g.get = (ids, comps) => {
      if (ids.includes(file.entity.eid)) reopened++
      return get(ids, comps)
    }
    let seen: Seen = { tails: new Map(), done: new Set() }
    for (let i = 0; i < 8; i++) await look(g, dir, seen, { slice: 0 })
    resumed = await told(g, 'old')
    opened = reopened
    Deno.writeTextFileSync(`${dir}/-home-me-code/old.jsonl`, lines('new'), {
      append: true,
    })
    await look(g, dir, seen)
    speaking = await told(g, 'old')
  },
)
test('an old transcript resumes its open tail across partial backfill slices', () => {
  assertEquals(resumed, ['a', 'said 0', 'b', 'said 1', 'c', 'said 2'])
  assertEquals(opened, 1)
})

test('an old transcript speaking again is followed at full depth', () => {
  assertEquals(speaking, [
    'a',
    'said 0',
    'b',
    'said 1',
    'c',
    'said 2',
    'new',
    'thought 0',
    'said 0',
  ])
  assertEquals(reopened, 2)
})
