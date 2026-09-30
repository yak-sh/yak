import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Comp, Graph } from '@yaks/graph'
import { ids, locked, lockOn, seed, store } from './testing.ts'
import { look, type Seen, service, stale, strip } from './service.ts'
import { callOf } from './tail.ts'
import { sessionEid } from './who.ts'

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
let projects = async (
  files: Record<string, { text: string; ago?: number }>,
  body: (dir: string) => Promise<void>,
) => {
  let dir = Deno.makeTempDirSync()
  for (let [name, f] of Object.entries(files)) {
    let path = `${dir}/-home-me-code/${name}.jsonl`
    Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    Deno.writeTextFileSync(path, f.text)
    let at = new Date(Date.now() - (f.ago ?? 0))
    Deno.utimeSync(path, at, at)
  }
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

test('the duty frees the locks whose holder is gone as it starts', async () => {
  let s = store()
  seed(s, { entity: { eid: ids.p2 }, claim: { session: ids.gone } })
  await service({ graph: locked(s) }, {}, AbortSignal.abort())
  assertEquals(lockOn(s, ids.p2), undefined)
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

test('a look reads the newest transcript first, and a long one a slice at a time', () =>
  projects({
    long: { text: lines('a', 'b', 'c'), ago: 1000 },
    live: { text: lines('hi') },
    old: { text: lines('x', 'y'), ago: 30 * DAY },
  }, async (dir) => {
    let g = locked(store())
    let seen: Seen = { tails: new Map(), done: new Set() }
    // A slice of nothing reads a line; a budget of nothing, one transcript.
    let once = (budget?: number) => look(g, dir, seen, { slice: 0, budget })
    await once(0)
    await once(0)
    assertEquals(await told(g, 'live'), ['hi', 'thought 0', 'said 0'])
    assertEquals(await told(g, 'long'), undefined)
    assertEquals(await told(g, 'old'), undefined)
    // With time to spare, a line of each, and of the old one too.
    await once()
    await once()
    assertEquals(await told(g, 'long'), ['a', 'thought 0', 'said 0'])
    assertEquals(await told(g, 'old'), ['x', 'said 0'])
    for (let i = 0; i < 4; i++) await once()
    assertEquals((await told(g, 'long'))!.length, 9)
    assertEquals(await told(g, 'old'), ['x', 'said 0', 'y', 'said 1'])
  }))

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

test('a managed run is read from its own output, not its transcript file', () =>
  projects({ run1: { text: lines('asked') } }, async (dir) => {
    let s = store()
    seed(s, {
      entity: { eid: 'request' },
      entry: { session: ids.run1 },
      content: { body: 'do it' },
      using: { provider: 'claude' },
    })
    let g = locked(s)
    await look(g, dir, { tails: new Map(), done: new Set() })
    assertEquals(await told(g, 'one'), ['do it'])
  }))

// A turn's ending, with what it cost.
let ended = JSON.stringify({
  type: 'result',
  total_cost_usd: 0.25,
  usage: { input_tokens: 10, output_tokens: 5 },
}) + '\n'

test('a session quiet past its full depth is stripped to its prose and its cost', () =>
  projects({
    past: { text: dated(lines('long ago') + tool + ended, 30 * DAY) },
    'past/subagents/agent-p': { text: dated(side(tool), 30 * DAY) },
    today: { text: lines('hello') + tool },
  }, async (dir) => {
    let g = locked(store())
    await look(g, dir, { tails: new Map(), done: new Set() }, {
      person: ids.ada,
    })
    await strip(g, await stale(g))
    assertEquals(await told(g, 'past'), ['long ago', 'said 0', '(call)'])
    let [past] = await g.read('.session.id=past')
    let [spent] = await g.read(`.entry.session=${past.entity.eid}&.cost&*`)
    assertEquals(spent.cost, { dollars: 0.25, reported: true })
    assertEquals(await told(g, 'p'), [])
    assertEquals(await told(g, 'today'), [
      'hello',
      'thought 0',
      'said 0',
      '(call)',
      'a.txt',
    ])
    assertEquals(await stale(g), [])
  }))
