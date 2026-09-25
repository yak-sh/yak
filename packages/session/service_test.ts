import { assertEquals } from '@std/assert'
import type { Graph } from '@yaks/graph'
import { ids, locked, lockOn, seed, store } from './testing.ts'
import { look, type Seen, service, stale, strip } from './service.ts'

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

// A Claude projects directory holding one transcript per session id, each
// last written `ago` milliseconds before now.
let projects = async (
  files: Record<string, { text: string; ago?: number }>,
  body: (dir: string) => Promise<void>,
) => {
  let dir = Deno.makeTempDirSync()
  Deno.mkdirSync(`${dir}/-home-me-code`)
  Deno.mkdirSync(`${dir}/-home-me-code/one/subagents`, { recursive: true })
  Deno.writeTextFileSync(
    `${dir}/-home-me-code/one/subagents/a.jsonl`,
    lines('no'),
  )
  for (let [id, f] of Object.entries(files)) {
    let path = `${dir}/-home-me-code/${id}.jsonl`
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

Deno.test('the duty frees the locks whose holder is gone as it starts', async () => {
  let s = store()
  seed(s, { entity: { eid: ids.p2 }, claim: { session: ids.gone } })
  await service({ graph: locked(s) }, {}, AbortSignal.abort())
  assertEquals(lockOn(s, ids.p2), undefined)
})

Deno.test('a recent transcript is followed in full; an old one is read in later, its prose alone', () =>
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
    // The subagent's transcript is not a session of its own.
    assertEquals((await g.read('.session')).length, 4)
  }))

Deno.test('a managed run is read from its own output, not its transcript file', () =>
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

Deno.test('a session quiet past its full depth is stripped to its prose', () =>
  projects({
    past: { text: dated(lines('long ago') + tool, 30 * DAY) },
    today: { text: lines('hello') + tool },
  }, async (dir) => {
    let g = locked(store())
    await look(g, dir, { tails: new Map(), done: new Set() }, {
      person: ids.ada,
    })
    await strip(g, await stale(g))
    assertEquals(await told(g, 'past'), ['long ago', 'said 0'])
    assertEquals(await told(g, 'today'), [
      'hello',
      'thought 0',
      'said 0',
      '(call)',
      'a.txt',
    ])
    assertEquals(await stale(g), [])
  }))
