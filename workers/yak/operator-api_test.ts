// The Operator's store through @yaks/api (operator-api.ts), as two people who
// share a space read and write it: each reads, and hears on a socket, only
// what is theirs or nobody's, and writes only their drafts, the archive
// marks on their own lines and the walkthrough marks on their own
// conversations. A socket stands by the seat its handshake read, and the
// directory saying a seat moved is what reads it again.
import { clock, equal, test, until } from '@yaks/testing'
import { UPDATE_WAITING, waitingFrom } from '@yaks/platform/update-waiting'
import { updateCards, updatesIn } from '@yaks/platform/update-rows'
import { operatorDrafts } from '@yaks/platform/operator-drafts'
import { operatorSettings } from '@yaks/platform/operator-settings'
import { operatorTalk, type Told } from '@yaks/platform/operator-talk'
import { personaFor } from './operator-persona.ts'
import {
  matchesOf,
  matchesPage,
  type Tapping,
} from '@yaks/platform/operator-matches'
import { matched } from '@yaks/trial/match'
import { matching } from './operator-trials.ts'
import type { Level } from '@yaks/member'
import { type Bundle, transient } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Wire } from '@yaks/durable-object'
import { operatorMemory } from './operator-testing.ts'
import { type Asker, operatorApi } from './operator-api.ts'
import { operatorFrames } from './operator-host.ts'
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

// Each person's seat in the space, as the directory has it now, and how
// many times it was read.
let seats = new Map<string, Level>([[ada.person, 'owner'], [
  bea.person,
  'editor',
]])
let seatReads = 0
let ctx = state()
let frames = operatorFrames(store)
let door = operatorApi(store, ctx, {
  seat: (person) => (seatReads++, Promise.resolve(seats.get(person) ?? null)),
  talks: frames.talks,
})
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

test('a person marks their own conversation a walkthrough, and nobody else’s', async () => {
  let mark = (eid: string, app: string | null = 'guestbook', rest = {}) => ({
    entity: { eid },
    walkthrough: app && { app },
    ...rest,
  })
  equal(await apply(ada, [mark(adas.root)]), 200)
  equal(await apply(ada, [mark(adas.root, null)]), 200)
  equal(await apply(bea, [mark(adas.root)]), 403)
  equal(await apply(ada, [mark(adas.line)]), 403)
  equal(await apply(ada, [mark(adas.root, 'guestbook', { doc: {} })]), 403)
  equal((await store.g.get([adas.root]))[0].walkthrough, undefined)
})

// A hibernatable socket as the runtime hands one over, subscribed to `q`:
// the frames it was sent, and its attachment.
let socket = async (
  who: Asker,
  q = '.entry&?content',
  host = door,
  // Whether it holds the seat its handshake read (build.ts `#operate`), as
  // a socket accepted before sockets held theirs does not.
  holds = true,
) => {
  let sent: Record<string, unknown>[] = []
  let held: unknown = null
  let ws: Wire = {
    readyState: 1,
    send: (data) => void sent.push(JSON.parse(data)),
    close: () => void (ws.readyState = 3),
    serializeAttachment: (v) => void (held = structuredClone(v)),
    deserializeAttachment: () => held,
  }
  let factory = globalThis as { WebSocketPair?: unknown }
  factory.WebSocketPair = function () {
    return { 0: {}, 1: ws }
  }
  try {
    await host.answer(
      new Request('https://builder/api/ws', {
        headers: { upgrade: 'websocket' },
      }),
      who,
      false,
      holds ? seats.get(who.person) ?? null : undefined,
    )
  } finally {
    delete factory.WebSocketPair
  }
  let subscribe = (q: string, id = q) =>
    host.message(ws, JSON.stringify({ subscribe: q, id }))
  await subscribe(q, 'lines')
  await until(() => sent.length > 0 || ws.readyState == 3)
  if (ws.readyState == 3) {
    throw new Error('closed at once: ' + JSON.stringify(held))
  }
  return Object.assign(sent, { ws, subscribe })
}

test('an expired approval leaves a live Updates count without another write', async () => {
  let time = clock(Date.now())
  let store = operatorMemory()
  await store.g.apply([
    { entity: { eid: id() }, session: {}, operator_session: ada },
    {
      entity: { eid: id() },
      task: {},
      decision: { question: 'Send the invitation?' },
      filed: { project: space, assignee: ada.person },
      operator_approval: { expires: new Date(time.now() + 5).toISOString() },
    },
  ], { trusted: true })
  let host = operatorApi(store, state(), {
    seat: () => Promise.resolve('owner'),
    clock: time,
  })
  let seen = await socket(ada, UPDATE_WAITING, host)
  try {
    let counts = () =>
      seen.flatMap((f) => (f.bundles as Bundle[] ?? []).map(waitingFrom))
        .map(({ count }) => count)
    equal(counts(), [1])
    await time.advance(6)
    await until(() => seen.length == 2)
    equal(counts(), [1, 0])
  } finally {
    await host.close(seen.ws)
  }
})

test('a person’s Updates cards are live: a notice shows as it is written, and an approval that lapses leaves', async () => {
  let time = clock(Date.now())
  let store = operatorMemory()
  await store.g.apply([
    { entity: { eid: id() }, session: {}, operator_session: ada },
    {
      entity: { eid: id() },
      task: {},
      decision: { question: 'Send the invitation?' },
      filed: { project: space, assignee: ada.person },
      operator_approval: { expires: new Date(time.now() + 5).toISOString() },
    },
  ], { trusted: true })
  let host = operatorApi(store, state(), {
    seat: () => Promise.resolve('owner'),
    clock: time,
  })
  let seen = await socket(ada, updateCards(space), host)
  // What the last frame left on the page, as its words.
  let held = new Map<string, Bundle>()
  let shown = () => {
    for (let f of seen.splice(0)) {
      if (f.reset) held.clear()
      for (let b of (f.bundles ?? []) as Bundle[]) held.set(b.entity.eid, b)
      for (let gone of (f.removed ?? []) as string[]) held.delete(gone)
    }
    return updatesIn([...held.values()], space).map((u) => u.words)
  }
  try {
    equal(shown(), ['Send the invitation?'])
    await store.g.apply([{
      entity: { eid: id() },
      notification: { to: ada.person },
      doc: { body: 'Recipes prints again.' },
    }], { trusted: true })
    await until(() => seen.length > 0)
    equal(shown(), ['Send the invitation?', 'Recipes prints again.'])
    await time.advance(6)
    await until(() => seen.length > 0)
    equal(shown(), ['Recipes prints again.'])
  } finally {
    await host.close(seen.ws)
  }
})

test('a person’s drafts are live on their page graph’s line, marked with the space, and nobody else’s', async () => {
  let [mine, theirs] = [
    await socket(ada, operatorDrafts(space)),
    await socket(bea, operatorDrafts(space)),
  ]
  let place = `operator:${adas.root}`
  try {
    equal(await apply(ada, [draft(ada, place)]), 200)
    await until(() =>
      mine.some((f) =>
        ((f.bundles ?? []) as Bundle[]).some((b) =>
          (b.draft as { place: string } | undefined)?.place == place
        )
      )
    )
    let heard = mine.flatMap((f) => (f.bundles ?? []) as Bundle[])
      .find((b) => (b.draft as { place: string }).place == place)!
    equal(heard.operatorDraft, { space })
    equal(
      theirs.flatMap((f) => (f.bundles ?? []) as Bundle[])
        .filter((b) => (b.draft as { by: string }).by != bea.person),
      [],
    )
  } finally {
    await door.close(mine.ws)
    await door.close(theirs.ws)
  }
})

test('the Operator’s settings are live on its settings page’s line: a name it gives itself is heard at once', async () => {
  let page = await socket(ada, operatorSettings(space))
  let named = () =>
    page.flatMap((f) => (f.bundles ?? []) as Bundle[])
      .map((b) => (b.operatorSettings as { name?: string | null }).name)
  try {
    await until(() => named().length > 0)
    await write([{
      entity: { eid: personaFor(space) },
      doc: { title: 'Iris' },
    }])
    await until(() => named().includes('Iris'))
    equal(
      page.flatMap((f) => (f.bundles ?? []) as Bundle[]).at(-1)
        ?.operatorSettings,
      {
        space,
        name: 'Iris',
        voice: null,
        voice_speed: null,
        voice_model: null,
        voice_backend: null,
      },
    )
  } finally {
    await door.close(page.ws)
  }
})

test('the Matches page’s lines are live: a round planned and a pick made in the chat are heard at once', async () => {
  let [rounds, round] = [
    await socket(ada, matchesPage(space)),
    await socket(ada, matchesPage(space, 'covers')),
  ]
  let last = (page: typeof rounds) =>
    matchesOf(page.flatMap((f) => (f.bundles ?? []) as Bundle[]).slice(-1))
  let tapped = () => last(round) as Tapping | undefined
  try {
    await until(() => last(rounds) != undefined)
    equal(last(rounds), { rounds: [] })
    await write(
      matched({ key: 'covers', title: 'Covers', sides: [id(), id()] }),
    )
    await until(() => JSON.stringify(last(rounds)).includes('Covers'))
    equal(
      (last(rounds) as { rounds: { title: string; left: number }[] }).rounds
        .map((r) => [r.title, r.left]),
      [['Covers', 1]],
    )
    await until(() => tapped()?.left == 1)
    await matching(store, ada.person, {
      round: 'covers',
      pair: 1,
      chose: 'first',
    })
    await until(() => tapped()?.left == 0)
    equal([tapped()?.picked, tapped()?.card], [1, undefined])
  } finally {
    await door.close(rounds.ws)
    await door.close(round.ws)
  }
})

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

test('a conversation’s watch hears where it stands, each step, and a reply as it is written, its person’s alone', async () => {
  let [mine, theirs] = [
    await socket(ada, operatorTalk(space, adas.root)),
    await socket(bea, operatorTalk(space)),
  ]
  let told = (frames: Record<string, unknown>[]) =>
    frames.flatMap((f) => (f.bundles ?? []) as Bundle[])
      .map((b) => b.operatorTalk as Told)
  let typed = (frames: Record<string, unknown>[]) =>
    frames.flatMap((f) => (f.transient ?? []) as { text?: string }[])
      .map((t) => t.text ?? '').join('')
  try {
    let [opening] = told(mine)
    equal([opening.n, typeof opening.standing], [0, 'string'])
    await frames.typing(adas.root, 'On ')
    await frames.typing(adas.root, 'it')
    await until(() => typed(mine) == 'On it')
    equal([told(mine).at(-1)?.writing, typed(mine)], [adas.root, 'On it'])
    // A watch opened again mid-reply, as after a reconnect, starts from the
    // words so far.
    let again = await socket(ada, operatorTalk(space, adas.root))
    await until(() => typed(again) == 'On it')
    await write([{
      entity: { eid: id() },
      entry: { session: adas.root, seq: 3 },
      content: { body: 'On it' },
    }])
    await frames.tell(adas.root)
    await until(() => told(mine).at(-1)?.n == 1)
    let [step] = told(mine).slice(-1)
    equal([step.n, (step.step as { task: string }).task], [1, adas.root])
    equal(
      mine.at(-1)?.transient,
      [{
        id: (mine.findLast((f) => f.transient && f.bundles)!.transient as {
          id: string
        }[])[0].id,
        entity: (mine.at(-1)!.bundles as Bundle[])[0].entity.eid,
        component: 'operatorTalk',
        property: 'typing',
        seq: 2,
        op: 'end',
      }],
    )
    equal([told(theirs).map((t) => t.n), typed(theirs)], [[0], ''])
    await door.close(again.ws)
  } finally {
    await door.close(mine.ws)
    await door.close(theirs.ws)
  }
})

test('a conversation’s watch in another space is answered with nothing', async () => {
  let page = await socket(ada, operatorTalk(id(), adas.root))
  try {
    equal(page.at(-1), { id: 'lines', bundles: [], reset: true })
  } finally {
    await door.close(page.ws)
  }
})

test('a socket reads its seat on no frame in and no delivery out', async () => {
  let was = seatReads
  let sent = await socket(ada, '.memory')
  try {
    await sent.subscribe('.draft')
    await write([{ entity: { eid: id() }, memory: {}, doc: { title: 'New' } }])
    await until(() => sent.filter((f) => f.id == 'lines').length > 1)
    equal(seatReads, was)
  } finally {
    await door.close(sent.ws)
  }
})

test('a socket that holds no seat reads it once, however many frames it sends', async () => {
  let fresh = operatorApi(store, state(), {
    seat: (person) => (seatReads++, Promise.resolve(seats.get(person) ?? null)),
  })
  let was = seatReads
  let sent = await socket(ada, '.memory', fresh, false)
  await sent.subscribe('.draft')
  await sent.subscribe('.doc')
  equal([seatReads - was, sent.ws.readyState], [1, 1])
  await fresh.close(sent.ws)
})

test('a person removed from the space hears nothing more once the directory says so, and their socket closes', async () => {
  let sent = await socket(bea, '.memory')
  let kept = await socket(ada, '.memory')
  let heard = sent.length
  seats.delete(bea.person)
  try {
    await door.reseat()
    await write([{ entity: { eid: id() }, memory: {}, doc: { title: 'New' } }])
    equal([sent.ws.readyState, sent.length, kept.ws.readyState], [
      3,
      heard,
      1,
    ])
  } finally {
    seats.set(bea.person, 'editor')
    await door.close(kept.ws)
  }
})

test('a person made a viewer is closed once the directory says so, and answered no new subscription', async () => {
  let sent = await socket(bea)
  let heard = sent.length
  seats.set(bea.person, 'viewer')
  try {
    await door.reseat()
    await sent.subscribe('.memory')
    equal([sent.ws.readyState, sent.length], [3, heard])
  } finally {
    seats.set(bea.person, 'editor')
  }
})

test('a seat the directory could not read is left as the socket held it', async () => {
  let failing = operatorApi(store, state(), {
    seat: () => Promise.reject(new Error('overloaded')),
  })
  let sent = await socket(ada, '.memory', failing)
  let refused = await failing.reseat().then(() => null, (e: Error) => e.message)
  await sent.subscribe('.draft')
  equal([refused, sent.ws.readyState], ['overloaded', 1])
  await failing.close(sent.ws)
})
