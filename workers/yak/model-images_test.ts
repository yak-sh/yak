import { assertAlmostEquals, assertEquals } from '@std/assert'
import { cleanup, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { objectBlobs } from '@yaks/blob'
import { artifactStore } from '@yaks/blob/identify'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { vale } from './models-probe.ts'
import { blobPrefix } from './blob-key.ts'

let imagePosts: { url: string; body: Record<string, unknown> }[] = []
let referencePng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
let referenceArt = Uint8Array.from(atob(referencePng), (c) => c.charCodeAt(0))
let imageApp = await vale(() => ({}), {
  env: {
    OPENAI_API_KEY: 'fixture-only',
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    MODEL_FETCH: (url, init) => {
      if (!init?.body) {
        return Promise.resolve(
          new Response(
            'Context Window | 100,000 tokens\nUnit Pricing | $0.15 per M input tokens, $0.5 per M output tokens',
          ),
        )
      }
      imagePosts.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      })
      return Promise.resolve(Response.json({
        data: [{ b64_json: referencePng }],
        usage: {
          input_tokens_details: { text_tokens: 10, image_tokens: 10_000 },
          output_tokens: 823,
        },
      }))
    },
  },
})
let imageSpace = (await imageApp.dir.space('ada'))!
let reference = await artifactStore(
  objectBlobs(imageApp.env.BLOBS, blobPrefix(imageSpace, imageApp.app)),
)(referenceArt, 'image/png')

let uploadPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
let upload = await artifactStore(
  objectBlobs(imageApp.env.BLOBS, blobPrefix(imageSpace, imageApp.app)),
)(Uint8Array.from(atob(uploadPng), (c) => c.charCodeAt(0)), 'image/png')
await imageApp.send('/apply', [{
  entity: { eid: upload.address },
  blob: { bytes: upload.size },
}])

let imageTurn = (
  session: string,
  artifact: string,
  previous = artifact,
): Bundle[] => [
  { entity: { eid: session }, session: {} },
  { entity: { eid: reference.address }, artifact: reference },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session, seq: 1 },
    content: { body: 'Character sheet: keep appearance' },
    attachment: { artifact, audience: 'model' },
  },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session, seq: 2 },
    content: { body: 'Previous page: use different composition' },
    attachment: { blob: previous, audience: 'model' },
  },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session, seq: 3 },
    content: { body: 'Draw the next story page' },
    using: { provider: 'openai', model: 'gpt-image-2.6-flare' },
    sending: { input: { quality: 'low', size: '1024x1024' } },
  },
]

test(
  'an app transcript sends explicit reference pixels and settles measured usage above its quote',
  async () => {
    cleanup(imageApp.close)
    let session = crypto.randomUUID()
    let res = await imageApp.send(
      '/apply',
      imageTurn(session, reference.address, upload.address),
    )
    assertEquals(res.status, 200, await res.text())
    await imageApp.settled()
    assertEquals(imagePosts.length, 1)
    assertEquals(imagePosts[0].url.endsWith('/images/edits'), true)
    assertEquals(imagePosts[0].body.images, [{
      image_url: 'data:image/png;base64,' + referencePng,
    }, { image_url: 'data:image/png;base64,' + uploadPng }])
    assertEquals(
      String(imagePosts[0].body.prompt).includes(
        'Character sheet: keep appearance',
      ),
      true,
    )
    let [answer] = await imageApp.read(
      `.entry.session=${session} .attachment .output&*`,
    )
    assertEquals(
      (answer?.attachment as Comp)?.artifact,
      reference.address,
    )
    assertAlmostEquals(
      (await imageApp.spent()).meter!.models,
      (10 * 5 + 10_000 * 8 + 823 * 30) / 1e6,
    )
    // Knowing another app's address cannot read its pixels. An artifact row
    // alone grants no access outside the executing app's scoped blob store.
    let missing = crypto.randomUUID()
    let foreign = await artifactStore(
      objectBlobs(imageApp.env.BLOBS, 'other/app/blobs/'),
    )(Uint8Array.from([...referenceArt, 0]), 'image/png')
    let rows = imageTurn(missing, foreign.address)
    rows[1] = { entity: { eid: foreign.address }, artifact: foreign }
    let denied = await imageApp.send('/apply', rows)
    assertEquals(denied.status, 200, await denied.text())
    await imageApp.settled()
    assertEquals(imagePosts.length, 1)
    assertEquals(
      (await imageApp.read(`.entry.session=${missing} .refusal`)).length,
      1,
    )
  },
)
