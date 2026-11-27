import { client } from '@yaks/client'
import { equal, ok, test, throws } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import {
  type Choice,
  motionId,
  roomLine,
  type Seat,
  type Turn,
} from './starter/room-model.ts'
import {
  act,
  ActionRefused,
  battle,
  FOES,
  HERO,
  REACH,
} from './starter/room-rules.ts'
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

// A room in rows: hero seats at tiles, foes by kind, and the ledger so far.
let R = 'r'
let rows = (
  heroes: [string, number, number, number?][],
  foes: [string, string, number, number][] = [],
  hits: [string, number, number?][] = [],
  steps = REACH,
): Bundle[] => [
  { entity: { eid: R }, play_turn: { seat: heroes[0][0], number: 1, steps } },
  ...heroes.map(([eid, x, z, life = 0]) => ({
    entity: { eid },
    play_pawn: { room: R, name: eid, x, z, life },
  })),
  ...foes.map(([eid, kind, x, z]) => ({
    entity: { eid },
    play_foe: { room: R, kind, x, z },
  })),
  ...hits.map(([target, dmg, life = 0], i) => ({
    entity: { eid: `hit${i}` },
    play_hit: {
      room: R,
      target,
      by: 'x',
      life,
      dmg,
      roll: 6,
      need: 1,
      number: i,
    },
  })),
]
// Play one action and fold its batch into the rows. `rolls` feed the d6 and
// the damage spread in turn: 0.99 rolls a 6, 0 a 1 and the least damage.
let play = (
  before: Bundle[],
  seats: string[],
  choice: Choice,
  rolls: number[] = [],
) => {
  let seat = (before[0].play_turn as Turn).seat
  let batch = act(
    { room: R, seat },
    seats,
    before,
    { ...choice, number: 1 },
    () => rolls.shift() ?? 0,
  )
  let after = structuredClone(before)
  for (let { entity, $was: _, ...parts } of batch) {
    let row = after.find((r) => r.entity.eid === entity.eid)
    if (!row) after.push(row = { entity })
    for (let [name, value] of Object.entries(parts)) {
      row[name] = { ...row[name] as object, ...value as object }
    }
  }
  return { ...battle(after, R), rows: after }
}
let refused = async (fn: () => unknown) =>
  ok((await throws(fn)) instanceof ActionRefused)

test('a move spends steps and keeps the turn, never past them or onto someone', async () => {
  let start = rows([['a', 0, 0], ['b', 0, 2]], [['w', 'wolf', 2, 0]])
  let walked = play(start, ['a', 'b'], { kind: 'move', x: 1, z: -1 })
  equal(walked.party[0], { ...walked.party[0], x: 1, z: -1 })
  equal(walked.turn, { seat: 'a', number: 2, steps: REACH - 2 })
  for (let [x, z] of [[0, 0], [REACH, 1], [0.5, 0], [0, 2], [2, 0]]) {
    await refused(() => play(start, ['a', 'b'], { kind: 'move', x, z }))
  }
  await refused(() =>
    play(walked.rows, ['a', 'b'], { kind: 'move', x: 1, z: 2 })
  )
})

test('a strike rolls against the foe and writes the ledger, hit or miss', async () => {
  let start = rows([['a', 0, 0], ['b', 0, 3]], [['w', 'wolf', 1, 0]])
  let hit = play(start, ['a', 'b'], { kind: 'strike', foe: 'w' }, [0.99, 0])
  equal(hit.foes[0].hp, FOES.wolf.most - 3)
  equal(hit.hits[0], { ...hit.hits[0], by: 'a', roll: 6, need: 3, dmg: 3 })
  equal(hit.turn?.seat, 'b')
  let miss = play(start, ['a', 'b'], { kind: 'strike', foe: 'w' }, [0])
  equal([miss.foes[0].hp, miss.hits[0].dmg], [FOES.wolf.most, 0])
  await refused(() =>
    play(rows([['a', 0, 0]], [['w', 'wolf', 2, 0]]), ['a'], {
      kind: 'strike',
      foe: 'w',
    })
  )
})

test('when the round ends every foe walks to the nearest hero and strikes', () => {
  let start = rows([['a', 0, 0], ['b', 6, 0]], [['w', 'wolf', 2, 0]])
  let next = { ...start[0], play_turn: { seat: 'b', number: 1, steps: 3 } }
  let round = play([next, ...start.slice(1)], ['a', 'b'], { kind: 'pass' }, [
    0.99,
    0,
  ])
  equal(round.foes[0], { ...round.foes[0], x: 1, z: 0 })
  equal(round.party.map((p) => p.hp), [HERO.most - 2, HERO.most])
  equal(round.turn, { seat: 'a', number: 2, steps: REACH })
})

test('a knocked-out hero loses their turns until an ally beside them revives them', async () => {
  let start = rows([['a', 0, 0], ['b', 0, 1], ['c', 5, 5]], [], [[
    'b',
    HERO.most,
  ]])
  let passed = play(start, ['a', 'b', 'c'], { kind: 'pass' })
  equal(passed.turn?.seat, 'c')
  let revived = play(start, ['a', 'b', 'c'], { kind: 'revive', seat: 'b' })
  equal(revived.party[1], { ...revived.party[1], life: 1, hp: HERO.most })
  equal(revived.turn?.seat, 'b')
  await refused(() =>
    play(start, ['a', 'b', 'c'], { kind: 'revive', seat: 'c' })
  )
  let fallen = rows([['a', 0, 0]], [['w', 'wolf', 1, 0]], [[
    'a',
    HERO.most - 1,
  ]])
  let last = play(fallen, ['a'], { kind: 'pass' }, [0.99, 0])
  equal(last.party[0].hp, 0)
  await refused(() => play(last.rows, ['a'], { kind: 'pass' }))
})
