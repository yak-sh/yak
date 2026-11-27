import { client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { partyPanel } from './party.ts'
import {
  roomFrames,
  RoomRefused,
  type RoomRules,
  rooms,
  type Seat,
} from './rooms.ts'
import { docs } from './vocab.ts'

// The least game a room holds: the seats take turns passing, and each shares
// where it points.
type Turn = { seat: string; number: number }
let words: VocabDoc = {
  $defs: {
    play_turn: {
      component: true,
      type: 'object',
      properties: { seat: { type: 'string' }, number: { type: 'integer' } },
    },
    play_motion: {
      component: true,
      type: 'object',
      sync: 'peers',
      durable: 'connection',
      properties: {
        room: { type: 'string' },
        seat: { type: 'string' },
        x: { type: 'number' },
      },
    },
  },
}
let rules: RoomRules<{ number: number }> = {
  line: (room) => `(.entity.eid=${room}&.play_turn)|.play_motion.room=${room}`,
  open: ({ room, seat }) => [{
    entity: { eid: room },
    play_turn: { seat, number: 1 },
  }],
  act: ({ room, seat }, seats, rows, { number }) => {
    let turn = rows.find((r) => r.entity.eid === room)?.play_turn as Turn
    if (turn.seat !== seat) throw new RoomRefused('Wait for your turn.')
    let next = seats[(seats.indexOf(seat) + 1) % seats.length]
    return [{
      entity: { eid: room },
      play_turn: { seat: next, number: number + 1 },
      $was: { play_turn: { number: token(number) } },
    }]
  },
  relay: ({ room, seat }, { play_motion }) => {
    let x = (play_motion as { x?: unknown } | undefined)?.x
    if (typeof x !== 'number') return
    return { entity: { eid: seat }, play_motion: { room, seat, x } }
  },
}
let serve = rooms(rules)

let vocab = [...docs, words]
let store = client(loadVocab(vocab))
let app = {
  APP: {
    fetch: async (path: string, init?: RequestInit): Promise<Response> => {
      if (path === '/apply') {
        let batch = JSON.parse(init?.body as string)
        try {
          return Response.json(await store.mutate(batch))
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'Stale') throw error
          return new Response(error.message, { status: 409 })
        }
      }
      if (path === '/vocab.json') return Response.json(vocab)
      let url = new URL(path, 'https://store.test')
      return Response.json(store.read(url.searchParams.get('q')!))
    },
  },
  FILES: { fetch: () => Promise.resolve(new Response(null, { status: 404 })) },
}

let request = (who: string, path: string, body?: unknown) =>
  serve(
    new Request('https://game.test/game/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-yak-app': 'game',
        'x-yak-via': who,
        ...(who === 'host' ? { 'x-yak-role': 'editor' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    app,
  )
let open = async () => {
  let response = await request('host', 'rooms', {})
  equal(response.status, 200)
  return await response.json() as Seat & { invite: string }
}

let first = await open()
let other = await open()
let path = `rooms/${first.room}/`
let joined =
  await (await request('guest', path + 'join', { invite: first.invite }))
    .json() as Seat
let state = () => store.ent(first.room)?.play_turn as Turn

test('only an editor hosts a room', async () => {
  equal((await request('guest', 'rooms', {})).status, 403)
})

test('a guest resumes only the room they joined and reads none of its invitation', async () => {
  equal(
    (await request('guest', `rooms/${other.room}/join`, {
      invite: first.invite,
    })).status,
    403,
  )
  equal((await request('guest', `rooms/${other.room}/query`)).status, 403)
  equal((await request('guest', path + 'join', {})).status, 200)
  let snapshot = await (await request('guest', path + 'query')).json()
  ok(snapshot.some((row: Bundle) => row.play_turn))
  ok(snapshot.every((row: Bundle) => !row.game_room))
})

test('a new invitation shuts out the old one, and a full room takes nobody', async () => {
  let room = await open()
  let at = `rooms/${room.room}/`
  let next = await (await request('host', at + 'invite', {})).json()
  equal((await request('guest', at + 'invite', {})).status, 403)
  equal((await request('a', at + 'join', { invite: room.invite })).status, 403)
  for (let who of ['a', 'b', 'c']) {
    equal((await request(who, at + 'join', next)).status, 200)
  }
  equal((await request('d', at + 'join', next)).status, 409)
})

test('a ticketed draft opens a live room from an opaque origin, and its files pass through', async () => {
  let mount = '/game/~k3f9x2ab7q1z/'
  let preview = (path: string, method = 'GET') =>
    serve(
      new Request('https://game.test' + mount + path, {
        method,
        headers: {
          origin: 'null',
          'x-yak-mount': mount,
          'x-yak-role': 'editor',
          'x-yak-via': 'preview',
        },
      }),
      app,
    )
  // A 404 lets the platform serve the compiled module.
  equal((await preview('main.ts')).status, 404)
  let hosted = await preview('rooms', 'POST')
  equal(hosted.status, 200)
  let { room } = await hosted.json() as Seat
  equal((await preview(`rooms/${room}/vocab.json`)).status, 200)
  equal((await preview(`rooms/${room}/ws`)).status, 426)
})

test('only one accepted action advances a turn, and only for its active seat', async () => {
  let turn = state()
  let action = { number: turn.number }
  equal((await request('guest', path + 'action', action)).status, 409)
  equal(state(), turn)
  let results = await Promise.all([
    request('host', path + 'action', action),
    request('host', path + 'action', action),
  ])
  equal(results.map((r) => r.status).sort(), [204, 409])
  equal(state(), { seat: joined.seat, number: turn.number + 1 })
})

test('a room socket scopes subscriptions and relays to the connected seat', () => {
  let emit = roomFrames(rules, joined)
  let frame = (message: unknown) => JSON.parse(emit(JSON.stringify(message))!)
  let line = rules.line(first.room)
  equal(
    emit(JSON.stringify({ subscribe: rules.line(other.room), id: 's1' })),
    undefined,
  )
  equal(frame({ subscribe: line, id: 's1' }), {
    id: 's1',
    subscribe: line,
    acks: true,
    frames: true,
  })
  equal(
    frame({
      relay: [{
        entity: { eid: first.seat },
        play_turn: { seat: first.seat, number: 100 },
        play_motion: { room: other.room, seat: first.seat, x: 1 },
      }],
    }),
    {
      relay: [{
        entity: { eid: joined.seat },
        play_motion: { room: first.room, seat: joined.seat, x: 1 },
      }],
    },
  )
  equal(emit(JSON.stringify({ relay: [{ entity: { eid: 'x' } }] })), undefined)
})

test('the party panel paints a health bar for each one the app lists, with no page code', () => {
  let { document } = parseHTML(
    '<html><head></head><body><div class="GameScreen_Hud"></div></body></html>',
  )
  let changed = () => {}
  let room = {
    value: [] as Bundle[],
    ready: false,
    subscribe: (fn: () => void) => {
      changed = fn
      return () => {}
    },
  }
  let lists = (rows: Bundle[]) => [
    {
      members: rows.map((r) =>
        r.hero as { name: string; hp: number; most: number }
      ),
    },
    { label: 'Foes', members: [] },
  ]
  let global = globalThis as { document?: Document }
  global.document = document
  try {
    partyPanel(room, lists, { doc: document })
    let panel = document.querySelector<HTMLElement>('.GameScreen_Hud > #party')!
    ok(panel.hidden)
    room.ready = true
    room.value = [
      {
        entity: { eid: 'a' },
        hero: { name: 'a', hp: 10, most: 10, turn: true },
      },
      { entity: { eid: 'b' }, hero: { name: 'b', hp: 0, most: 10 } },
    ]
    changed()
    ok(!panel.hidden)
    equal(
      [...panel.querySelectorAll('.Party_Member')].map((m) =>
        [
          m.className.replace(/\bParty_Member\b ?/, ''),
          m.querySelector('.Party_Name')!.textContent,
          !!m.querySelector('.Meter'),
          m.querySelector('.Party_Hp')!.textContent,
        ].join(' ')
      ),
      ['Party_Member-turn a true 10/10', 'Party_Member-down b true Down'],
    )
    equal(panel.querySelectorAll('ul').length, 1)
  } finally {
    delete global.document
    store.close()
  }
})
