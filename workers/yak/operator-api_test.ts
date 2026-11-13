// The Operator's store through @yaks/api (operator-api.ts), as two people who
// share a space read and write it: each reads, and hears on a socket, only
// what is theirs or nobody's, and writes only their drafts and the archive
// marks on their own lines.
import { equal, test, until } from '@yaks/testing'
import { type Bundle, transient } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Wire } from '@yaks/durable-object'
import { operatorMemory } from './operator-testing.ts'
import { type Asker, operatorApi } from './operator-api.ts'
import { state } from './testing.ts'

let id = () => crypto.randomUUID()
let space = id()
let ada: Asker = { person: id(), space }
let bea: Asker = { person: id(), space }
let store = operatorMemory()
let write = (bundles: Bundle[]) => store.g.apply(bundles, { trusted: true })
// Each person's conversation and its first line, and a memory nobody owns.
let conversation = async (who: Asker) => {
  let root = id(), line = id()
  await write([
    { entity: { eid: root }, session: {}, operator_session: who },
    {
      entity: { eid: line },
      entry: { session: root, seq: 1 },
      content: { body: `${who == ada ? 'Ada' : 'Bea'} asks` },
    },
  ])
  return { root, line }
}
let adas = await conversation(ada), beas = await conversation(bea)
let shared = id()
await write([{ entity: { eid: shared }, memory: {}, doc: { title: 'Ours' } }])

let ctx = state()
let door = operatorApi(store, ctx)
let ask = async (who: Asker, path: string, init?: RequestInit) =>
  await door.answer(new Request('https://builder/api' + path, init), who)
let read = async (who: Asker, q: string) =>
  ((await (await ask(who, '/query?q=' + encodeURIComponent(q)))
    .json()) as Bundle[]).map((b) => b.entity.eid).sort()
let apply = async (who: Asker, bundles: Bundle[]) =>
  (await ask(who, '/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundles),
  })).status
let draft = (by: Asker, place = 'operator', as = by) => ({
  entity: { eid: draftEid(as.person, place) },
  draft: { by: as.person, place, text: 'Remind me' },
  typed: { over: '' },
})

test('a person reads through the door what is theirs and what is nobody’s', async () => {
  equal(await read(ada, '.entry'), [adas.line])
  equal(await read(bea, '.entry'), [beas.line])
  equal(await read(bea, '.memory'), [shared])
  equal(await read(bea, `.entity.eid=${adas.root},${adas.line}`), [])
})

test('a person writes their own drafts and the archive marks on their own lines, and nothing else', async () => {
  let archive = (eid: string) => ({ entity: { eid }, archived: {} })
  equal(await apply(ada, [draft(ada)]), 200)
  equal(await apply(ada, [draft(ada, `operator:${adas.root}`)]), 200)
  equal(await apply(ada, [draft(ada, 'operator', bea)]), 403)
  equal(await apply(bea, [draft(bea, `operator:${adas.root}`)]), 403)
  equal(await apply(bea, [archive(adas.line)]), 403)
  equal(await apply(ada, [archive(adas.line)]), 200)
  equal(
    await apply(ada, [{ entity: { eid: shared }, doc: { title: 'Mine' } }]),
    403,
  )
  // A batch with one bundle that is not theirs keeps none of it.
  equal(await apply(bea, [archive(beas.line), archive(adas.line)]), 403)
  let [line] = await store.g.get([beas.line], ['archived'])
  equal([!!line.archived, await read(bea, '.draft')], [false, []])
  equal((await store.g.get([shared], ['doc']))[0].doc, { title: 'Ours' })
})

// A hibernatable socket as the runtime hands one over: the frames it was
// sent, and its attachment.
let socket = async (who: Asker) => {
  let sent: Record<string, unknown>[] = []
  let held: unknown = null
  let ws: Wire = {
    readyState: 1,
    send: (data) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v) => void (held = structuredClone(v)),
    deserializeAttachment: () => held,
  }
  let factory = globalThis as { WebSocketPair?: unknown }
  factory.WebSocketPair = function () {
    return { 0: {}, 1: ws }
  }
  try {
    await ask(who, '/ws', { headers: { upgrade: 'websocket' } })
  } finally {
    delete factory.WebSocketPair
  }
  await door.message(
    ws,
    JSON.stringify({ subscribe: '.entry&?content', id: 'lines' }),
  )
  await until(() => sent.length > 0)
  return sent
}

test('a socket hears its person’s lines, and a reply as it is written, and nobody else’s', async () => {
  let [heard, overheard] = [await socket(ada), await socket(bea)]
  let reply = id()
  await write([{
    entity: { eid: reply },
    entry: { session: adas.root, seq: 2 },
    content: { body: '' },
  }])
  let writer = await transient(store.g).begin(reply, 'content', 'body', id())
  writer.append('On it')
  await until(() => heard.some((f) => f.transient))
  // The lines each socket was sent, and the text as it was written.
  let carried = (frames: Record<string, unknown>[]) => ({
    lines: [
      ...new Set(
        frames.flatMap((f) => (f.bundles ?? []) as Bundle[])
          .map((b) => b.entity.eid),
      ),
    ].sort(),
    typed: frames.flatMap((f) => (f.transient ?? []) as { text?: string }[])
      .map((t) => t.text ?? '').join(''),
  })
  equal(carried(heard), {
    lines: [adas.line, reply].sort(),
    typed: 'On it',
  })
  equal(carried(overheard), { lines: [beas.line], typed: '' })
  await writer.discard()
})
