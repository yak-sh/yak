import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { ids, locked, store } from './testing.ts'
import { claude } from './readers.ts'
import { callOf, pull, tail } from './tail.ts'

let c = (b: Bundle | undefined, name: string) => b?.[name] as Comp | undefined

let human = { origin: { kind: 'human' } }
let typed = (text: string, at = '2026-09-01T00:00:00.000Z') => ({
  type: 'user',
  message: { content: text },
  timestamp: at,
  ...human,
})
let reply = (...content: unknown[]) => ({
  type: 'assistant',
  message: { content },
})
let use = {
  type: 'tool_use',
  id: 'toolu_1',
  name: 'Bash',
  input: { command: 'ls' },
}
let answer = {
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a b' }],
  },
}

// A transcript file of these lines, and a graph to read it into.
let file = async (
  body: (
    g: Graph,
    log: (...l: unknown[]) => void,
    path: string,
  ) => Promise<void>,
) => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/one.jsonl`
  let log = (...lines: unknown[]) =>
    Deno.writeTextFileSync(
      path,
      lines.map((l) => typeof l == 'string' ? l : JSON.stringify(l)).join(
        '\n',
      ) + '\n',
      { append: true },
    )
  try {
    await body(locked(store()), log, path)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

// A session's transcript, in entry order, as the kinds each entry wears.
let told = async (g: Graph, session: string) =>
  (await g.read(`.entry.session=${session}&.order=entry.seq&*`)).map((b) =>
    ['content', 'output', 'reasoning', 'notice', 'call', 'result']
      .filter((k) => b[k]).join('+')
  )

Deno.test('a transcript file becomes the session it names, at full depth', () =>
  file(async (g, log, path) => {
    log(
      typed('fix it'),
      reply({ type: 'thinking', thinking: 'look first' }, use),
      'not json at all',
      answer,
      reply({ type: 'text', text: 'fixed' }),
    )
    let t = await tail(g, path, { id: 'fresh' })
    assertEquals(await pull(g, t, claude, { person: ids.ada }), 5)
    let [s] = await g.read('.session.id=fresh&*')
    assertEquals(c(s, 'session')?.operator, true)
    assertEquals(await told(g, s.entity.eid), [
      'content',
      'content+output+reasoning',
      'call',
      'content+result',
      'content+output',
    ])
    let [input] = await g.read(
      `.entry.session=${s.entity.eid}&.order=entry.seq&*`,
    )
    assertEquals(c(input, 'created')?.by, ids.ada)
    assertEquals(c(input, 'created')?.at, '2026-09-01T00:00:00.000Z')
    // The call names its tool, and its result says it went through.
    let call = callOf(s.entity.eid, 'toolu_1')
    let [made] = await g.storage.tx((tx) => tx.get([call]))
    assertEquals(c(made, 'call')?.to, toolEid('Bash'))
    assertEquals(c(made, 'execution'), { state: 'done', by: s.entity.eid })
    let [tool] = await g.storage.tx((tx) => tx.get([toolEid('Bash')]))
    assertEquals(c(tool, 'tool')?.name, 'Bash')
  }))

Deno.test('a tail reads on from where the transcript stands, and never twice', () =>
  file(async (g, log, path) => {
    log(typed('one'))
    let t = await tail(g, path, { session: ids.run1 })
    await pull(g, t, claude)
    assertEquals(await pull(g, t, claude), 0)
    log(reply({ type: 'text', text: 'two' }))
    assertEquals(await pull(g, t, claude), 1)
    // A new tail, as after a restart, starts past what the session holds.
    log(typed('three'))
    let again = await tail(g, path, { session: ids.run1 })
    assertEquals(again.line, 2)
    await pull(g, again, claude)
    assertEquals(await told(g, ids.run1), [
      'content',
      'content+output',
      'content',
    ])
  }))

Deno.test('prose alone: what was typed and what the model said', () =>
  file(async (g, log, path) => {
    log(
      typed('fix it'),
      reply({ type: 'thinking', thinking: 'hmm' }, use),
      answer,
      reply({ type: 'text', text: 'fixed' }),
    )
    let t = await tail(g, path, { session: ids.run1 })
    await pull(g, t, claude, { prose: true })
    assertEquals(await told(g, ids.run1), ['content', 'content+output'])
  }))
