// The app's workflow on the platform in memory, from its own vocab.json,
// seed.json and worker.js: a video's script (here a stand-in for the model
// step), auditions for each character, the person's choice of voice, each line
// voiced once its character's voice is chosen, and the cut once all are.
import { equal, test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { modelToolEid } from '@yaks/builders/model'
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
import worker, { cast } from './worker.js'
import { progress, stage } from './model.js'

let read = (path: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`./${path}`, import.meta.url)))
let { $defs } = read('vocab.json') as { $defs: Record<string, Comp> }
let components = Object.fromEntries(
  Object.entries($defs).filter(([, d]) => !d.tool)
    .map(([name, d]) => [name, { ...d, component: true }]),
)
let tools = Object.fromEntries(
  Object.entries($defs).filter(([, d]) => d.tool),
)
// The model step answered by a stand-in command, so the test spends nothing.
tools.script = { ...tools.voice_line, worker: '/script' }

let VOICES = [
  { id: 'v-brian', name: 'Brian', about: 'deep, calm, middle aged man' },
  { id: 'v-grace', name: 'Grace', about: 'young woman, bright, warm' },
  { id: 'v-ollie', name: 'Ollie', about: 'old man, gravelly, warm' },
  { id: 'v-mabel', name: 'Mabel', about: 'old woman, kind, slow' },
]

// What the script step's model answers for a video: two characters and
// three lines, the second character's line in the middle.
let script = (video: string) => {
  let role = (slot: string, title: string, about: string) => ({
    slot,
    inputs: [video],
    components: { role: { video, about }, doc: { title } },
  })
  let line = (n: number, who: string, body: string) => ({
    slot: `line ${n}`,
    inputs: [video],
    components: { line: { video, role: `$${who}`, n }, doc: { body } },
  })
  return {
    outputs: [
      role('role 1', 'Captain', 'old man, gravelly, warm'),
      role('role 2', 'Wren', 'young woman, bright'),
      line(1, 'role 1', 'The tide waits for no one.'),
      line(2, 'role 2', 'Then we sail tonight.'),
      line(3, 'role 1', 'Aye, tonight it is.'),
    ],
  }
}

test('a video is scripted, auditioned, cast by its person, voiced and cut', async () => {
  await using p = platform()
  let { env } = p
  let { space, app } = await seeded(env, 'private')
  let spoken: string[] = []
  // The platform's /api/ as the app's worker reaches it through env.APP.
  let api = {
    fetch: (path: string, init?: RequestInit) => {
      if (path.startsWith('speech/voices')) {
        return Response.json({ provider: 'elevenlabs', voices: VOICES })
      }
      if (path == 'speech/speak') {
        let { voice, text } = JSON.parse(String(init!.body))
        spoken.push(`${voice}: ${text}`)
        return new Response(`${voice}: ${text}`)
      }
      if (path == 'blob') {
        let said = new TextDecoder().decode(init!.body as ArrayBuffer)
        return Response.json({ eid: `blob ${said}` })
      }
      return new Response('no', { status: 404 })
    },
  }
  // How many times the cut's step ran: once, when the last line is voiced.
  let cuts = 0
  env.DISPATCH = {
    get: () => ({
      fetch: async (req: Request) => {
        if (new URL(req.url).pathname.endsWith('/assemble')) cuts++
        if (!new URL(req.url).pathname.endsWith('/script')) {
          return await worker.fetch(req, { APP: api })
        }
        let { binding } = await req.json()
        return Response.json(script(binding.entities[0]))
      },
    }),
  } as Dispatch
  let store = appStore(env.STORE, space, app)
  let send = async (path: string, body: unknown) => {
    let res = await store(path, {
      method: 'POST',
      body: JSON.stringify(body),
    }, ADA_OWNS)
    let said = await res.text()
    assertEquals(res.status, 200, said)
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
      let found = await rows(`${q}&built.current=true&*`)
      return found.length == n ? found : null
    }, { label: `${n} of ${q}` })

  await send('/vocab', { $defs: components })
  await send('/tools', parseTools({ $defs: tools }, ['doc']))
  // The seed's steps as written, the script step pointed at the stand-in.
  await send(
    '/apply',
    (read('seed.json') as Bundle[]).map((b) => {
      let made = b.builder as Comp | undefined
      if (made?.to != modelToolEid()) return b
      let { content: _, using: __, ...rest } = b
      return { ...rest, builder: { ...made, to: toolEid('script') } }
    }),
  )
  let shown = async () =>
    stage(progress(video, await rows('.built.current=true&*')))
  let video = crypto.randomUUID()
  await send('/apply', [{
    entity: { eid: video },
    video: {},
    doc: {
      title: 'Night sail',
      body: 'A captain and a deckhand decide to sail.',
    },
  }])

  // Each character auditions three voices, saying its first line, and its
  // person is asked which to use. Nothing is voiced before they answer.
  let asked = await count('.decision', 2)
  let auditioned = await count('.audition', 6)
  let question = (who: string) =>
    asked.find((d) => (d.doc as Comp).title == `Voice for ${who}`)!
  equal(
    (question('Captain').decision as Comp).choices,
    ['Ollie', 'Brian', 'Grace'].map((label) => ({
      label,
      description: VOICES.find((v) => v.name == label)!.about,
    })),
  )
  equal((question('Captain').decision as Comp).recommended, 'Ollie')
  equal((question('Captain').filed as Comp).assignee, ADA)
  assertEquals(auditioned.length, 6)
  equal(
    spoken.toSorted(),
    [
      'v-ollie: The tide waits for no one.',
      'v-brian: The tide waits for no one.',
      'v-grace: The tide waits for no one.',
      'v-grace: Then we sail tonight.',
      'v-mabel: Then we sail tonight.',
      'v-brian: Then we sail tonight.',
    ].toSorted(),
  )
  assertEquals((await rows('.voicing&*')).length, 0)
  assertEquals(await shown(), 'Choose a voice for Captain, Wren.')

  // The Captain's lines are voiced once their voice is chosen; Wren's wait.
  spoken = []
  await send('/apply', [{
    entity: question('Captain').entity,
    decided: { choice: 'Ollie' },
  }])
  await count('.voicing', 2)
  equal(spoken.toSorted(), [
    'v-ollie: Aye, tonight it is.',
    'v-ollie: The tide waits for no one.',
  ])
  assertEquals((await rows('.cut&built.current=true')).length, 0)

  // Choosing the last voice voices the last line and cuts the video.
  await send('/apply', [{
    entity: question('Wren').entity,
    decided: { choice: 'Grace' },
  }])
  let [made] = await count('.cut', 1)
  equal((made.cut as Comp).clips, [
    {
      n: 1,
      who: 'Captain',
      text: 'The tide waits for no one.',
      audio: 'blob v-ollie: The tide waits for no one.',
    },
    {
      n: 2,
      who: 'Wren',
      text: 'Then we sail tonight.',
      audio: 'blob v-grace: Then we sail tonight.',
    },
    {
      n: 3,
      who: 'Captain',
      text: 'Aye, tonight it is.',
      audio: 'blob v-ollie: Aye, tonight it is.',
    },
  ])
  equal([(made.doc as Comp).title, cuts], ['Night sail', 1])
  assertEquals(await shown(), 'Ready to play.')
})

test('voices are auditioned by the words they share with the character', () => {
  equal(
    cast('old man, gravelly', VOICES).map((v: { name: string }) => v.name),
    [
      'Ollie',
      'Brian',
      'Mabel',
    ],
  )
  equal(
    cast('', [...VOICES, VOICES[0]], 9).map((v: { name: string }) => v.name),
    [
      'Brian',
      'Grace',
      'Ollie',
      'Mabel',
    ],
  )
})
