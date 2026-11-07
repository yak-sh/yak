// The Operator makes an image itself (operator-images.ts): asked of the
// Image API on the platform's key, charged to the space's budget, kept as an
// Operator file in the space's files and drawn under the step that made it.
import { assertAlmostEquals, assertEquals, assertRejects } from '@std/assert'
import { mint } from '@yaks/graph'
import { test } from '@yaks/testing'
import { CallError } from '@yaks/tools/errors'
import { parseHTML } from 'linkedom'
import { directoryOf, stamp } from './directory.ts'
import { monthOf } from './meter.ts'
import type { File } from './operator-channels.ts'
import { imageNew } from './operator-images.ts'
import { rows } from './operator-view.ts'
import { platform } from './testing.ts'

let PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
let usage = {
  input_tokens: 12,
  input_tokens_details: { text_tokens: 12, image_tokens: 0 },
  output_tokens: 1000,
}

let p = platform('operator images')
let sent: { url: string; body: Record<string, unknown> }[] = []
let env = {
  ...p.env,
  OPENAI_API_KEY: 'sk-test',
  MODEL_FETCH: (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init!.body)) })
    return Promise.resolve(
      Response.json({ data: [{ b64_json: PNG }], output_format: 'png', usage }),
    )
  },
} as typeof p.env
let eid = mint()
await stamp(env, {
  entities: [{
    entity: { eid },
    space: { slug: 'easel-' + eid, store: eid },
    budget: { dollars: 1 },
    starter: { dollars: 0 },
    meter: { month: monthOf(new Date()), models: 0 },
  }],
})
let space = (await directoryOf(env.STORE).at(eid))!
let tool = imageNew(env, space)
let made = await tool.run({
  prompt: 'A yak in gouache',
  size: '1024x1024',
  quality: 'low',
}) as { text: string; with: { operator_files: { files: File[] } } }
let [file] = made.with.operator_files.files

test('an image is asked of the default model and kept in the space’s files', async () => {
  assertEquals(sent.map((s) => [s.url, s.body.model, s.body.quality]), [
    [
      'https://api.openai.com/v1/images/generations',
      'gpt-image-2.6-flare',
      'low',
    ],
  ])
  assertEquals([file.name, file.mime], ['image.png', 'image/png'])
  assertEquals(file.key.startsWith(`${eid}/.operator/`), true)
  let kept = await env.BLOBS.get(file.key)
  assertEquals(
    new Uint8Array(await kept!.arrayBuffer()),
    Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)),
  )
  assertEquals(made.text.includes(file.key.split('/').at(-1)!), true)
})

test('the image is charged to the space’s budget at its usage', async () => {
  let used = (await directoryOf(env.STORE).at(eid))!.meter!.models
  assertAlmostEquals(used, (12 * 5 + 1000 * 30) / 1e6, 1e-9)
})

test('a prompt or setting the model can correct is refused, not a fault', async () => {
  for (
    let args of [{ prompt: ' ' }, { prompt: 'x', model: 'dall-e-3' }, {
      prompt: 'x',
      size: 'huge',
    }]
  ) await assertRejects(async () => await tool.run(args), CallError)
})

test('the picture a step made is drawn under it, opening the original', () => {
  let session = mint(), call = mint(), result = mint()
  let html = rows([
    {
      entity: { eid: call },
      entry: { session },
      call: { to: 'image_new', args: { prompt: 'A yak' } },
    },
    {
      entity: { eid: result },
      entry: { session },
      result: { call },
      content: { body: made.text },
      operator_files: { files: [file] },
    },
  ], (name) => ({ doing: name, done: name })).map((r) => r.html).join('')
  let img = parseHTML(`<div>${html}</div>`).document.querySelector(
    '.Talk_Picture img',
  )
  assertEquals(img?.getAttribute('src'), `?attachment=${result}&file=0`)
})
