import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Graph } from '@yaks/graph'
import { claude, type Reader } from './readers.ts'
import { locked, store } from './testing.ts'
import { pull, recount, tail } from './tail.ts'

let reply = (id: string, input: number) => ({
  type: 'assistant',
  message: {
    id,
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: `said ${id}` }],
    usage: { input_tokens: input, output_tokens: 1 },
  },
})

// A run's log as it was read before requests were: each reply's words, and
// what the whole run used on its ending.
let before: Reader = (e) =>
  e.type == 'result'
    ? { entries: [{ stop: {}, usage: { input_tokens: 30, output_tokens: 2 } }] }
    : { ...claude(e), entries: claude(e).entries.filter((c) => !c.ask) }

let used = async (g: Graph, session: string) =>
  (await g.read(`.entry.session=${session} .usage .order=entry.seq *`))
    .map((b) => (b.usage as { input_tokens: number }).input_tokens)

let log = async (): Promise<string> => {
  let path = await Deno.makeTempFile({ suffix: '.jsonl' })
  await Deno.writeTextFile(
    path,
    [reply('msg_1', 10), reply('msg_2', 20), { type: 'result' }]
      .map((e) => JSON.stringify(e)).join('\n') + '\n',
  )
  return path
}

// A session whose run's own log was read before requests were.
let read = async (g: Graph, path: string, id: string) => {
  let [s] = await g.apply([{ entity: { eid: '$s' }, session: { id } }])
  let session = s.entity.eid
  await pull(g, await tail(g, path, { session }), before, { final: true })
  return session
}

test('reading a log again counts each request once, with what it carried', async () => {
  let g = locked(store())
  let path = await log(), copy = await log()
  try {
    let session = await read(g, path, 'r')
    assertEquals(await used(g, session), [30])
    assertEquals(await recount(g, path, claude, { session }), 2)
    assertEquals(await used(g, session), [10, 20])
    assertEquals((await g.read('.context_parts')).length, 2)
    // Its words stay where the first reading put them.
    assertEquals((await g.read('.content')).length, 2)
    assertEquals(await recount(g, path, claude, { session }), 0)
    // A copy of a run's log, such as the transcript its provider keeps, counts
    // the requests in place of the whole run's usage on its ending; a reader
    // that sees the run only whole leaves it there.
    let other = await read(g, copy, 'q')
    assertEquals(await recount(g, path, before, { session: other }), 0)
    assertEquals(await used(g, other), [30])
    assertEquals(await recount(g, path, claude, { session: other }), 2)
    assertEquals(await used(g, other), [10, 20])
  } finally {
    await Deno.remove(path)
    await Deno.remove(copy)
  }
})
