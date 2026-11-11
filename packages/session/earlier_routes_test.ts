import { equal, test } from '@yaks/testing'
import type { Graph } from '@yaks/graph'
import { PATH, routes } from './routes.ts'
let g = {} as Graph
let door = routes({ graph: g }).find((r) => r.path == '/session/earlier')!
test('earlier words refuse browser-origin requests before reading the graph', async () => {
  let r = await door.handle(
    new Request('http://localhost/session/earlier', {
      method: 'POST',
      headers: { origin: 'https://elsewhere.example' },
      body: '{}',
    }),
  )
  equal(r.status, 403)
})
test('malformed earlier-word input is a caller error, not a graph read', async () => {
  let r = await door.handle(
    new Request('http://localhost/session/earlier', {
      method: 'POST',
      body: 'bad json',
    }),
  )
  equal(r.status, 400)
})
test('a host without a configured person discloses no history', async () => {
  let r = await door.handle(
    new Request('http://localhost/session/earlier', {
      method: 'POST',
      body: JSON.stringify({ words: 'files', before: '2026-01-01T00:00:00Z' }),
    }),
  )
  equal(await r.text(), '')
})

// A prompt hook answered by a host whose person said "keep attachments
// immutable" before, ranked by a meaning index that takes `wait` ms.
let said = {
  entity: { eid: 'old' },
  entry: { session: 's' },
  content: { body: 'keep attachments immutable' },
  created: { by: 'ada', at: '2026-01-01T00:00:00Z' },
}
let prompted = async (rank: number, prompt = 'immutable attachments') => {
  let graph = {
    vocab: { comp: () => undefined, all: [], kindOf: () => 'entry' },
    address: (ids: string[]) =>
      Promise.resolve(new Map(ids.map((i) => [i, i]))),
    get: (ids: string[]) =>
      Promise.resolve(
        ids[0] == 'ada'
          ? [{ entity: { eid: 'ada' }, doc: { title: 'Ada' } }]
          : [said],
      ),
    read: () => Promise.resolve([]),
  } as unknown as Graph
  let hook = routes({
    graph,
    config: { person: 'ada' },
    meaning: () =>
      new Promise((done) =>
        setTimeout(
          () => done([{ entity: 'old', similarity: .9, excerpt: '' }]),
          rank,
        )
      ),
  }, { wait: 20 }).find((r) => r.path == PATH)!
  let r = await hook.handle(
    new Request(`http://localhost${PATH}`, {
      method: 'POST',
      body: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt,
      }),
    }),
  )
  return (await r.json()).hookSpecificOutput?.additionalContext ?? ''
}
test("a prompt's context carries its person's earlier words on the subject", async () => {
  equal((await prompted(0)).includes('"keep attachments immutable"'), true)
})
test('a recall slower than its wait is left out rather than holding the prompt', async () => {
  equal(await prompted(60), '')
})
test("a background task's notification is nobody's words and recalls nothing", async () => {
  let notice = '<task-notification>\nimmutable attachments</task-notification>'
  equal(await prompted(0, notice), '')
})
