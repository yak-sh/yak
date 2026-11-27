// The app's workflow on the platform in memory, from its own vocab.json,
// seed.json and worker.js: the idea scripted and storyboarded (a stand-in
// answers for the model), each role auditioned, its person choosing the
// voice, each line voiced, each shot filmed (here the test answers for the
// studio), the cut assembled, and the finished file. Changing one line says
// that line again and nothing else.
import { equal, test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseTools } from '@yaks/tools/declared'
import type { Bundle, Comp } from '@yaks/graph'
import type { Dispatch } from '../../workers/yak/door.ts'
import { appStore, storeName } from '../../workers/yak/directory.ts'
import {
  ADA,
  ADA_OWNS,
  platform,
  seeded,
} from '../../workers/yak/serving-probe.ts'
import worker, { cast, json } from './worker.js'
import { mp3ms, progress, stage, timeline } from './model.js'

let read = (path: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`./${path}`, import.meta.url)))
let { $defs } = read('vocab.json') as { $defs: Record<string, Comp> }
let components = Object.fromEntries(
  Object.entries($defs).filter(([, d]) => !d.tool)
    .map(([name, d]) => [name, { ...d, component: true }]),
)
let tools = Object.fromEntries(Object.entries($defs).filter(([, d]) => d.tool))

let VOICES = [
  { id: 'v-brian', name: 'Brian', about: 'deep, calm, middle aged man' },
  { id: 'v-grace', name: 'Grace', about: 'young woman, bright, warm' },
  { id: 'v-mabel', name: 'Mabel', about: 'old woman, kind, slow' },
]

let CUSTOM = [
  { id: 'clone', name: 'Clone', about: 'reader', custom: true },
  { id: 'design', name: 'Design', about: 'announcer', custom: true },
  { id: 'library', name: 'Saved from the library', about: '', custom: true },
]

// One MPEG-1 layer III frame header at 128 kbps, 44.1 kHz: 417 bytes, 1152
// samples (26.1 ms).
let frame = () => {
  let f = new Uint8Array(417)
  f.set([0xff, 0xfb, 0x90, 0x00])
  return f
}
let mp3 = (frames: number) => {
  let out = new Uint8Array(417 * frames)
  for (let i = 0; i < frames; i++) out.set(frame(), i * 417)
  return out
}

let SCRIPT = {
  roles: [{ name: 'Narrator', about: 'warm, calm, woman' }],
  lines: [
    { role: 'Narrator', text: 'Ask for an app.' },
    { role: 'Narrator', text: 'Share it.' },
  ],
}
let BOARD = {
  shots: [
    {
      title: 'Asking',
      page: '/yourname/operator',
      as: 'yourname',
      steps: [{ wait: 500 }],
      lines: [1],
    },
    {
      title: 'The app',
      page: '/yourname',
      as: 'yourname',
      steps: [],
      lines: [2],
    },
  ],
}

test('an idea is scripted, storyboarded, cast, voiced, filmed, cut and rendered', async () => {
  await using p = platform()
  let { env } = p
  let { space, app } = await seeded(env, 'private')
  let store = appStore(env.STORE, space, app)
  let spoken: string[] = []
  // The app's own /api/ as its worker reaches it through env.APP: the store
  // itself, and stand-ins for the model, speech and blobs.
  let api = {
    fetch: async (path: string, init?: RequestInit) => {
      if (path == 'ai/run') {
        let { input } = JSON.parse(String(init!.body))
        let asked = input.messages[0].content as string
        let said = asked.startsWith('Plan the shots') ? BOARD : SCRIPT
        return Response.json({
          response: '```json\n' + JSON.stringify(said) + '\n```',
        })
      }
      if (path.startsWith('speech/voices')) {
        let provider = new URL(path, 'http://x').searchParams.get('provider')
        assertEquals(provider, 'elevenlabs')
        return Response.json({ provider, voices: [...VOICES, ...CUSTOM] })
      }
      if (path == 'speech/speak') {
        let { provider, voice, text } = JSON.parse(String(init!.body))
        assertEquals(provider, 'elevenlabs')
        spoken.push(`${voice}: ${text}`)
        return new Response(mp3(text.length))
      }
      if (path == 'blob') return Response.json({ eid: crypto.randomUUID() })
      return await store(`/${path}`, init ?? {}, ADA_OWNS)
    },
  }
  env.DISPATCH = {
    get: () => ({ fetch: (req: Request) => worker.fetch(req, { APP: api }) }),
  } as Dispatch
  let send = async (path: string, body: unknown) => {
    let res = await store(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      ADA_OWNS,
    )
    assertEquals(res.status, 200, await res.text())
  }
  let rows = async (q: string): Promise<Bundle[]> => {
    await p.object(storeName(space, app)).alarm()
    await p.settled()
    return await (await store(
      `/query?q=${encodeURIComponent(q)}`,
      {},
      ADA_OWNS,
    )).json()
  }
  let count = (q: string, n: number) =>
    until(async () => {
      let found = await rows(`${q}&*`)
      return found.length == n ? found : null
    }, { label: `${n} of ${q}` })
  let shown = async () => stage(progress(video, await rows('*')))

  await send('/vocab', { $defs: components })
  await send('/tools', parseTools({ $defs: tools }, ['doc']))
  await send('/apply', read('seed.json'))
  let video = crypto.randomUUID()
  await send('/apply', [{
    entity: { eid: video },
    video: { seconds: 30 },
    doc: { title: 'yaks.app', body: 'Build, host and share web apps.' },
  }])

  // The script and storyboard; the role auditioned and its person asked.
  let [asked] = await count('.decision', 1)
  equal((asked.filed as Comp).assignee, ADA)
  await count('.panel', 2)
  let lines = await count('.line', 2)
  equal(lines.map((l) => (l.line as Comp).panel).sort(), [1, 2])
  assertEquals(await shown(), 'Choose a voice for Narrator.')

  let auditions = (await count('.audition', 5)).map((b) => b.audition as Comp)
  equal(auditions.filter((a) => a.audio).map((a) => a.voice).sort(), [
    'clone',
    'v-brian',
    'v-grace',
  ])
  // Choosing an account voice beyond the auditions says both lines in it.
  spoken = []
  await send('/apply', [{
    entity: asked.entity,
    decided: { choice: 'Saved from the library' },
  }])
  let voiced = await count('.voicing', 2)
  equal(spoken.sort(), ['library: Ask for an app.', 'library: Share it.'])
  equal(
    voiced.map((v) => (v.voicing as Comp).ms as number).sort((a, b) => a - b),
    [235, 392],
  )
  let takes = await count('.take', 2)
  assertEquals(await shown(), 'Filming shots: 0 of 2.')

  // The studio films each shot; the last one filmed cuts the video.
  for (let t of takes) {
    await send('/apply', [{
      entity: t.entity,
      take: { film: `film ${(t.take as Comp).n}`, ms: 4000 },
      completed: {},
    }])
  }
  let [cut] = await count('.cut', 1)
  equal(((cut.cut as Comp).shots as Comp[]).map((s) => s.film), [
    'film 1',
    'film 2',
  ])
  let [film] = await count('.film', 1)
  assertEquals(await shown(), 'Rendering the video…')
  await send('/apply', [{
    entity: film.entity,
    film: { file: 'the mp4', ms: 3000 },
  }])
  assertEquals(await shown(), 'Finished.')

  // Changing a line says that line again, and only that line.
  spoken = []
  let first = lines.find((l) => (l.line as Comp).n == 1)!
  await send('/apply', [{
    entity: first.entity,
    doc: { body: 'Ask Cove for an app.' },
  }])
  await until(async () => {
    let said = await rows('.voicing&*')
    return said.some((v) => (v.doc as Comp).body == 'Ask Cove for an app.')
  }, { label: 'the changed line said again' })
  equal(spoken, ['library: Ask Cove for an app.'])
  assertEquals((await rows('.take')).length, 2)
})

test('an MP3 runs as long as its frames say', () => {
  equal(mp3ms(mp3(100)), 2612)
  let tagged = new Uint8Array([
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    0,
    0,
    0,
    2,
    0,
    0,
    ...mp3(10),
  ])
  equal(mp3ms(tagged), 261)
})

test('the cut gives each shot the time its lines need', () => {
  let row = (eid: string, comp: string, props: Comp, doc?: Comp) => ({
    entity: { eid },
    [comp]: props,
    ...doc ? { doc } : {},
  })
  let cut = timeline({
    shots: [
      row('s2', 'panel', { n: 2 }, { title: 'Two' }),
      row('s1', 'panel', { n: 1 }, { title: 'One' }),
    ],
    lines: [
      row('l1', 'line', { n: 1, panel: 1 }, { body: 'a' }),
      row('l2', 'line', { n: 2, panel: 1 }, { body: 'b' }),
    ],
    voicings: [
      row('v1', 'voicing', { line: 'l1', ms: 1000, audio: 'A' }, {
        title: 'N',
      }),
      row('v2', 'voicing', { line: 'l2', ms: 500, audio: 'B' }, { title: 'N' }),
    ],
    takes: [row('t2', 'take', { panel: 's2', film: 'F2', ms: 9000 })],
  })
  equal(cut.clips.map((c) => [c.n, c.at, c.ms]), [[1, 300, 1000], [
    2,
    1650,
    500,
  ]])
  equal(cut.shots.map((s) => [s.n, s.at, s.ms, s.film]), [
    [1, 0, 2850, null],
    [2, 2850, 2500, 'F2'],
  ])
  equal(cut.ms, 5350)
})

test('voices are auditioned by the words they share with the role', () => {
  equal(cast('old woman, kind', VOICES).map((v: { name: string }) => v.name), [
    'Mabel',
    'Grace',
    'Brian',
  ])
})

test('a model’s JSON is read whether or not it is fenced', () => {
  equal(json('Sure:\n```json\n{"a": 1}\n```'), { a: 1 })
})
