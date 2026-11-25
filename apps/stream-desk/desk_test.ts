// The desk on the platform in memory, from the app's own vocab.json and
// seed.json, against a mock OBS with a mock obs-ptz camera: phones write cues,
// the desk plays them into OBS in order and marks each aired or missed.
import { equal, test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { appStore } from '../../workers/yak/directory.ts'
import { ADA_OWNS, platform, seeded } from '../../workers/yak/serving-probe.ts'
import { connect } from './obs.js'
import { desk } from './desk.js'
import { DESK, due, onAir, present, shots, STALE } from './model.js'
import { look, proposal } from './watch.js'
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
    relay: (v: Comp | null) => v && relayed.push(v),
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

test('the desk publishes on connect and scene changes, then clears its status', async () => {
  let event: ((type: string, data: Comp) => void) | undefined
  let relayed: (Comp | null)[] = []
  let d = await desk({
    query: () => [],
    apply: () => {},
    obs: {
      call: (type: string) => {
        equal(type, 'GetSceneList')
        return { currentProgramSceneName: 'Opening', scenes: [] }
      },
      on: (heard: typeof event) => {
        event = heard
        return () => event = undefined
      },
    },
    relay: (status: Comp | null) => relayed.push(status),
  })
  event?.('SceneListChanged', { scenes: [{ sceneName: 'Wide' }] })
  event?.('CurrentProgramSceneChanged', { sceneName: 'Wide' })
  let status = present([{ entity: { eid: DESK }, desk: relayed.at(-1) }])
  equal(status, { scene: 'Wide', scenes: ['Wide'] })
  d.stop()
  equal(event, undefined)
  equal(relayed, [
    { scene: 'Opening', scenes: [] },
    { scene: 'Opening', scenes: ['Wide'] },
    { scene: 'Wide', scenes: ['Wide'] },
    null,
  ])
  equal(present([]), null)
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

test('the Operator looks at each scene, hears the last minute, and proposes a shot nobody plays until it is taken', async () => {
  let { p, apply, query, press } = await opened()
  await using _ = p
  await using obs = mockObs()
  let client = await connect(obs.url, 'desk')
  let d = await desk({
    query,
    apply,
    obs: client,
    relay: () => {},
    wait: () => Promise.resolve(),
  })
  await press({ shot: SHOT.projector })
  await d.kick()
  let asked: Comp[] = []
  let see = (request: Comp) => {
    asked.push(request)
    return Promise.resolve({
      response: 'Sure. {"shot": "pulpit", "why": "A speaker is at the pulpit"}',
      usage: { prompt_tokens: 900, completion_tokens: 20 },
    })
  }
  let turns = [
    { text: 'Let us sing.', from: 0, to: 2 },
    { text: 'Please be seated. Our reading today', from: 70, to: 74 },
  ]
  let all = shots(await query('.shot&?doc'))
  let cues = await query('.cue&?aired&?created')
  let once = () =>
    query('.cue&.suggested&?created').then((suggested) =>
      look({
        obs: client,
        see,
        apply,
        shots: all,
        lit: onAir(cues, all, d.scene()),
        turns,
        suggested,
        now: 80,
      })
    )
  let { usage, next } = await once()
  equal(usage, { prompt_tokens: 900, completion_tokens: 20 })
  equal(next, { shot: SHOT.pulpit, why: 'A speaker is at the pulpit' })
  let [content] = (asked[0].input as Comp).messages as Comp[]
  let parts = content.content as Comp[]
  equal(parts.map((x) => x.type), [
    'text',
    'image_url',
    'image_url',
    'image_url',
  ])
  let text = String(parts[0].text)
  assert(text.includes('On air: Projector.'))
  assert(text.includes('Please be seated. Our reading today'))
  assert(!text.includes('Let us sing.'))
  assert(
    String((parts[1].image_url as Comp).url).startsWith('data:image/png'),
  )

  // Proposed again, it is not written twice; and the desk leaves it alone.
  await once()
  let [offer, ...more] = await query('.cue&.suggested')
  equal(more, [])
  await d.kick()
  equal(obs.state.program, 'Projector')

  // Taken, it plays like any press.
  await apply({ entity: offer.entity, suggested: null })
  await d.kick()
  equal(obs.state.program, 'Camera')
  equal(obs.state.camera.preset, '2')
  d.stop()
  client.close()
  await client.closed
})

test('a model answer becomes a proposal only when it names another shot', () => {
  let all = [
    { entity: { eid: 'a' }, doc: { title: 'Projector' }, shot: {} },
    { entity: { eid: 'b' }, doc: { title: 'Pulpit' }, shot: {} },
  ]
  let said = (text: string, lit = 'a') => proposal(text, all, lit)
  equal(said('{"shot": "PULPIT", "why": "sermon"}'), {
    shot: 'b',
    why: 'sermon',
  })
  equal(said('{"shot": "Projector"}'), null)
  equal(said('{"shot": null}'), null)
  equal(said('{"shot": "Balcony"}'), null)
  equal(said('no json here'), null)
  equal(said('{"shot": '), null)
})
