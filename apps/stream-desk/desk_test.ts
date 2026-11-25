// The desk on the platform in memory, from the app's own vocab.json and
// seed.json, against a mock OBS with a mock obs-ptz camera: phones write cues,
// the desk plays them into OBS in order and marks each aired or missed.
import { equal, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { appStore } from '../../workers/yak/directory.ts'
import { ADA_OWNS, platform, seeded } from '../../workers/yak/serving-probe.ts'
import { connect } from './obs.js'
import { desk } from './desk.js'
import { AWAY, DESK, due, onAir, present, STALE } from './model.js'
import { mockObs } from './mock_obs.ts'

let read = (path: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`./${path}`, import.meta.url)))
let { $defs } = read('vocab.json') as { $defs: Record<string, Comp> }
let components = Object.fromEntries(
  Object.entries($defs).map(([name, d]) => [name, { ...d, component: true }]),
)
let SHOT = {
  projector: '5d0c1f9e-7a43-4b8e-9a51-0b6f2a7c8e01',
  wide: '5d0c1f9e-7a43-4b8e-9a51-0b6f2a7c8e02',
  pulpit: '5d0c1f9e-7a43-4b8e-9a51-0b6f2a7c8e03',
}

// The app's store, written and read as a phone does.
let opened = async () => {
  let p = platform()
  let { space, app } = await seeded(p.env, 'private')
  let store = appStore(p.env.STORE, space, app)
  let post = async (path: string, body: unknown) => {
    let res = await store(path, {
      method: 'POST',
      body: JSON.stringify(body),
    }, ADA_OWNS)
    let said = await res.text()
    assertEquals(res.status, 200, said)
    return JSON.parse(said)
  }
  let apply = (b: Bundle | Bundle[]) => post('/apply', [b].flat())
  let query = async (q: string): Promise<Bundle[]> =>
    await (await store(`/query?q=${encodeURIComponent(q)}`, {}, ADA_OWNS))
      .json()
  await post('/vocab', { $defs: components })
  await apply(read('seed.json'))
  let press = (cue: Comp) =>
    apply({ entity: { eid: crypto.randomUUID() }, cue })
  return { p, apply, query, press }
}

test('the desk plays each pressed cue into OBS and marks it', async () => {
  let { p, apply, query, press } = await opened()
  await using _ = p
  await using obs = mockObs()
  let client = await connect(obs.url, 'desk')
  let relayed: Comp[] = []
  let d = await desk({
    query,
    apply,
    obs: client,
    relay: ({ seen: _, ...v }: Comp) => relayed.push(v),
    wait: () => Promise.resolve(),
  })
  equal(relayed, [{
    scene: 'Projector',
    scenes: ['Projector', 'Camera', 'PIP'],
  }])

  // The pulpit: its preset first, off air, then the cut. Wide is the same
  // scene, so only the camera moves. A zoom step runs and stops the motor.
  await press({ shot: SHOT.pulpit })
  await press({ shot: SHOT.wide })
  await press({ zoom: 1 })
  await apply({
    entity: { eid: '$lobby' },
    doc: { title: 'Lobby' },
    shot: { scene: 'Lobby', n: 9 },
  })
  let [lobby] = await query('.shot.scene=Lobby')
  await press({ shot: lobby.entity.eid })
  await d.kick()

  equal(obs.asked, [
    'GetSceneList',
    'ptz_preset_recall',
    'SetCurrentProgramScene',
    'ptz_preset_recall',
    'ptz_move',
    'ptz_move',
    'SetCurrentProgramScene',
  ])
  equal(obs.state.program, 'Camera')
  equal(obs.state.camera, { preset: '1', zoom: 0.5, moves: [0.5, 0] })
  equal(relayed.at(-1), {
    scene: 'Camera',
    scenes: ['Projector', 'Camera', 'PIP'],
  })
  let cues = await query('.cue&?aired&?missed')
  equal(cues.map((c) => !!c.aired), [true, true, true, false])
  equal(
    (cues[3].missed as Comp).reason,
    'No source was found by the name of `Lobby`.',
  )
  // Nothing is played twice.
  await d.kick()
  assertEquals(obs.asked.length, 7)

  // A cut made at OBS itself reaches every page, and lights no button.
  obs.cut('Projector')
  await new Promise((done) => setTimeout(done, 20))
  equal(d.scene(), 'Projector')
  let shots = await query('.shot')
  equal(onAir(cues, shots, 'Camera'), SHOT.wide)
  equal(onAir(cues, shots, 'Projector'), null)
  d.stop()
  client.close()
  equal(await client.closed, 'OBS closed the connection (1005)')
})

test('the desk heartbeat survives a store round trip', async () => {
  let { p, apply, query } = await opened()
  await using _ = p
  await using obs = mockObs()
  let client = await connect(obs.url, 'desk')
  let d = await desk({
    query,
    apply,
    obs: client,
    relay: (status: Comp) => apply({ entity: { eid: DESK }, desk: status }),
  })
  try {
    let status = present(await query('.desk'), Date.now())
    equal(status?.scene, 'Projector')
    equal(status?.scenes, ['Projector', 'Camera', 'PIP'])
  } finally {
    d.stop()
    client.close()
    await client.closed
  }
})

test('OBS refuses a wrong password', async () => {
  await using obs = mockObs()
  await assertRejects(
    () => connect(obs.url, 'guess'),
    Error,
    'OBS refused the password',
  )
})

test('a cue pressed while the desk was away is missed, not played', () => {
  let at = (ms: number) => ({ at: new Date(ms).toISOString() })
  let cue = (n: number, ms: number, more = {}): Bundle => ({
    entity: { eid: `c${n}` },
    cue: {},
    created: at(ms),
    ...more,
  })
  let now = 1_000_000
  let { play, stale } = due([
    cue(3, now - 10),
    cue(1, now - STALE - 1),
    cue(2, now - 20),
    cue(4, now, { aired: at(now) }),
  ], now)
  equal([play, stale].map((l: Bundle[]) => l.map((c) => c.entity.eid)), [
    ['c2', 'c3'],
    ['c1'],
  ])
})

test('a desk not heard from for a while is away', () => {
  let desk = (ms: number) => [{
    entity: { eid: DESK },
    desk: { scene: 'Camera', seen: new Date(ms).toISOString() },
  }]
  let now = 1_000_000
  equal(present(desk(now - AWAY), now)?.scene, 'Camera')
  equal(present(desk(now - AWAY - 1), now), null)
  equal(present([], now), null)
})
