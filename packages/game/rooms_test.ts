import { client } from '@yaks/client'
import { equal, ok, test, throws } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import {
  motionId,
  roomLine,
  type Seat,
  type Turn,
} from './starter/room-model.ts'
import { act, ActionRefused, REACH } from './starter/room-rules.ts'
import { roomFrames } from './starter/room-wire.ts'
import { rooms } from './starter/worker.ts'
import words from './starter/vocab.json' with { type: 'json' }

let store = client(loadVocab(words as VocabDoc))
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
      if (path === '/vocab.json') return Response.json([words])
      let url = new URL(path, 'https://store.test')
      return Response.json(store.read(url.searchParams.get('q')!))
    },
  },
  FILES: { fetch: () => Promise.resolve(new Response(null, { status: 404 })) },
}

let request = (who: string, path: string, body?: unknown) =>
  rooms(
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

test('a guest resumes only the room they joined and reads its public components', async () => {
  equal(
    (await request('guest', `rooms/${other.room}/join`, {
      invite: first.invite,
    })).status,
    403,
  )
  equal((await request('guest', `rooms/${other.room}/query`)).status, 403)
  equal((await request('guest', path + 'join', {})).status, 200)
  let snapshot = await (await request('guest', path + 'query')).json()
  ok(snapshot.some((row: { play_turn?: unknown }) => row.play_turn))
  ok(snapshot.every((row: { play_room?: unknown }) => !row.play_room))
})

test('a ticketed draft can load its module and open a live room from an opaque origin', async () => {
  let mount = '/game/~k3f9x2ab7q1z/'
  let preview = (path: string, method = 'GET') =>
    rooms(
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
  equal((await preview('room-page.ts')).status, 404)
  let hosted = await preview('rooms', 'POST')
  equal(hosted.status, 200)
  let { room } = await hosted.json() as Seat
  equal((await preview(`rooms/${room}/vocab.json`)).status, 200)
  equal((await preview(`rooms/${room}/ws`)).status, 426)
})

test('only one accepted action advances a turn, and only for its active seat', async () => {
  let turn = state()
  let action = { number: turn.number, kind: 'pass' }
  equal((await request('guest', path + 'action', action)).status, 409)
  equal(state(), turn)
  let results = await Promise.all([
    request('host', path + 'action', action),
    request('host', path + 'action', action),
  ])
  equal(results.map((r) => r.status).sort(), [204, 409])
  equal(state().seat, joined.seat)
  equal(state().number, turn.number + 1)
  store.close()
})

test('a room socket scopes subscriptions and relays to the connected seat', () => {
  let emit = roomFrames(joined)
  let frame = (message: unknown) => JSON.parse(emit(JSON.stringify(message))!)
  equal(
    emit(JSON.stringify({ subscribe: roomLine(other.room), id: 's1' })),
    undefined,
  )
  equal(frame({ subscribe: roomLine(first.room), id: 's1' }), {
    id: 's1',
    subscribe: roomLine(first.room),
    acks: true,
    frames: true,
  })
  equal(
    frame({
      relay: [{
        entity: { eid: first.seat },
        play_turn: { seat: first.seat, number: 100 },
        play_motion: { room: other.room, seat: first.seat, x: 1, z: 4 },
      }],
    }),
    {
      relay: [{
        entity: { eid: motionId(joined) },
        play_motion: { room: first.room, seat: joined.seat, x: 1, z: 4 },
      }],
    },
  )
})

test('a move walks to the tapped tile within reach, and nowhere else', async () => {
  let seat = { room: 'r', seat: 'a' }
  let turn = { seat: 'a', number: 1 }
  let move = (x: number, z: number) =>
    act(seat, ['a', 'b'], turn, { room: 'r', x: 0, z: 0 }, {
      number: 1,
      kind: 'move',
      x,
      z,
    }, () => 1)
  equal(move(1, -2)[0], { entity: { eid: 'a' }, play_pawn: { x: 1, z: -2 } })
  for (let [x, z] of [[0, 0], [REACH, 1], [0.5, 0]]) {
    ok((await throws(() => move(x, z))) instanceof ActionRefused)
  }
})
