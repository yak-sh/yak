// A recording an app keeps at ./api/blob, heard whole through
// ./api/speech/hear (hearings.ts) with Deepgram stood in for: the store hears
// it as an effect, writes each turn with its speaker and seconds, and charges
// its minutes once; a file past what the provider hears, or a budget that
// can't cover it, is refused in words that say so; a failed hearing is asked
// again.
import type { Comp } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { fetch } from './apps.ts'
import { appStore, stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { KERNEL, metaOf } from './meta.ts'
import { budget } from './meter.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'
import { unread } from './speech.ts'
import { shaOf } from './hearings.ts'

// Deepgram's answer to the bytes it is sent: two speakers' turns, or a 400
// for bytes it can't hear.
let sent: number[] = []
let deepgram = endpoints(globalThis).open(async (req) => {
  let bytes = new Uint8Array(await req.arrayBuffer())
  sent.push(bytes.length)
  if (bytes[0] == 0) return new Response('corrupt audio', { status: 400 })
  return Response.json({
    metadata: { duration: 7200 },
    results: {
      channels: [{ alternatives: [{ transcript: 'I move. Second.' }] }],
      utterances: [
        { speaker: 0, transcript: 'I move.', start: 1.5, end: 2.5 },
        { speaker: 1, transcript: 'Second.', start: 3, end: 3.5 },
      ],
    },
  })
})

let p = platform({ DEEPGRAM_API_KEY: 'a-key', SPEECH_API: deepgram.url })
let { dir, space, app } = await seeded(p.env, 'private')
await stamp(p.env, {
  entities: [{
    entity: { eid: space.eid },
    budget: { dollars: 5 },
    starter: { dollars: 0 },
  }],
})
let cookie = await as(ADA)
let g = metaOf(appStore(p.env.STORE, space, app, p.env), KERNEL)
let spent = async () => budget((await dir.space('ada'))!).spent.toFixed(4)

let upload = async (bytes: Uint8Array<ArrayBuffer>) =>
  (await (await fetch(
    visit('/cookbook/api/blob', {
      method: 'POST',
      headers: { cookie, 'content-type': 'audio/mpeg' },
      body: bytes,
    }),
    p.env,
  )).json()).url as string
let hear = async (blob: unknown) => {
  let res = await fetch(
    visit('/cookbook/api/speech/hear', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ blob }),
    }),
    p.env,
  )
  return [res.status, await res.json()]
}
let rows = async (q: string) =>
  (await g.query(q, { trusted: true })) as unknown as Record<string, Comp>[]
let row = async (eid: string) => (await rows(`.entity.eid=${eid}&*`))[0]

test('a kept recording is heard whole in its store, its turns written and charged once', async () => {
  unread()
  sent = []
  let url = await upload(new Uint8Array(32_000).fill(7))
  let [status, { recording }] = await hear(url)
  equal(status, 202)
  await p.settled()
  let turns = (await rows(`.heard_turn.recording=${recording}&*`))
    .map((b) => b.heard_turn).toSorted((a, b) =>
      Number(a.from) - Number(b.from)
    )
  equal(turns, [
    { recording, speaker: 0, text: 'I move.', from: 1.5, to: 2.5 },
    { recording, speaker: 1, text: 'Second.', from: 3, to: 3.5 },
  ])
  equal(sent, [32_000])
  // Two hours at $0.0043 a minute.
  equal(await spent(), '0.5160')
  // Asked again, it answers what was heard and hears nothing more.
  equal(await hear(url), [200, {
    recording,
    seconds: 7200,
    turns: 2,
    speakers: true,
  }])
  equal(sent, [32_000])
  equal(await spent(), '0.5160')
  // Deleting the upload deletes what it said.
  await g.apply([{ entity: { eid: shaOf(url)! }, $delete: true }], KERNEL)
  equal(await rows(`.heard_turn.recording=${recording}`), [])
})

test('a recording the provider can’t hear fails with its reason, and is heard when asked again', async () => {
  unread()
  sent = []
  let bytes = new Uint8Array(16_000)
  let url = await upload(bytes)
  let [, { recording }] = await hear(url)
  await p.settled()
  equal(
    (await row(recording)).failed?.reason,
    'deepgram answered 400 to /v1/listen: corrupt audio',
  )
  bytes[0] = 1
  // Bytes the provider can hear now, under the same address.
  let { get } = p.env.BLOBS
  p.env.BLOBS.get = async (key, o) => {
    let got = await get.call(p.env.BLOBS, key, o)
    return got && { ...got, body: new Response(bytes).body! }
  }
  try {
    equal((await hear(url))[0], 202)
    await p.settled()
  } finally {
    p.env.BLOBS.get = get
  }
  let done = await row(recording)
  equal([done.heard?.turns, done.failed], [2, undefined])
  equal(sent, [16_000, 16_000])
})

test('a recording past what the provider hears, or past the budget, is refused in words that say so', async () => {
  unread()
  let url = await upload(new Uint8Array(8).fill(3))
  let { head } = p.env.BLOBS
  p.env.BLOBS.head = async (key) => {
    let got = await head.call(p.env.BLOBS, key)
    return got && { ...got, size: 3 * 1024 ** 3 }
  }
  try {
    equal(await hear(url), [413, {
      error: {
        code: 'too_large',
        message: 'Speech hears a recording of up to 2 GB; this one is 3 GB.',
      },
    }])
  } finally {
    p.env.BLOBS.head = head
  }
  equal((await hear('./api/blob/' + 'f'.repeat(64)))[0], 404)
  equal((await hear(7))[0], 400)
  await stamp(p.env, {
    entities: [{ entity: { eid: space.eid }, budget: { dollars: 0 } }],
  })
  try {
    equal((await hear(url))[0], 402)
  } finally {
    await stamp(p.env, {
      entities: [{ entity: { eid: space.eid }, budget: { dollars: 5 } }],
    })
  }
})
