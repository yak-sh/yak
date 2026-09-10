import { assert, assertEquals, assertRejects } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'
import { images } from './images.ts'
import { responses } from '@yaks/openai'
import { remote } from './remote.ts'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
Deno.test('generated artifacts survive database reopen and keep payloads out of transcript and requests', async () => {
  let dir = await Deno.makeTempDir()
  let db = dir + '/graph.db', directory = dir + '/images'
  let requests: string[] = []
  let image = {
    type: 'image_generation_call',
    id: 'ig_1',
    status: 'completed',
    result: png,
    output_format: 'png',
  }
  let model = responses({
    credential: () => ({ token: 'test', base: 'https://api.openai.com/v1' }),
    images: images({ directory }),
    fetch: ((_url, init) => {
      requests.push(String(init?.body))
      let frames = [
        { type: 'response.output_item.done', item: image },
        { type: 'response.output_item.done', item: { ...image, id: 'ig_2' } },
        {
          type: 'response.completed',
          response: { id: 'r1', status: 'completed', model: 'gpt-4.1' },
        },
      ]
      return Promise.resolve(
        new Response(
          frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }) as typeof fetch,
  })
  let a = agent({ h: open(db), cwd: dir, model, name: 'gpt-4.1', tools: [] })
  try {
    let id = await a.start('draw')
    await a.idle(id)
    let entries = await a.transcript(id)
    assertEquals(entries.filter((e) => e.attachment).length, 2)
    assert(!JSON.stringify(entries).includes(png))
    let artifacts = await a.h.g.read('.artifact')
    assertEquals(artifacts.length, 1)
    let artifact = artifacts[0].artifact as { address: string; size: number }
    assertEquals(
      await Deno.readFile(directory + '/' + artifact.address),
      Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
    )
    await a.send(id, 'again')
    await a.idle(id)
    assert(!requests.some((r) => r.includes(png)))
    assertEquals(Array.from(Deno.readDirSync(directory)).length, 1)
    a.close()
    let h = open(db)
    try {
      assertEquals((await h.g.read('.artifact')).length, 1)
    } finally {
      h.close()
    }
  } finally {
    // close is idempotent at the driver boundary; all model turns are idle.
    a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('host store failure returns no artifact and retry repairs partial bytes', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let store = images({ directory: dir }).store
    let bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    let first = await store(bytes, 'image/png')
    await Deno.writeFile(dir + '/' + first.address, bytes.slice(0, 2))
    assertEquals(await store(bytes, 'image/png'), first)
    assertEquals(await Deno.readFile(dir + '/' + first.address), bytes)
    await Deno.writeTextFile(dir + '/not-dir', 'file')
    await assertRejects(() =>
      images({ directory: dir + '/not-dir' }).store(bytes, 'image/png')
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('image options cross the worker boundary without serializing callbacks', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({
    db: ':memory:',
    cwd: dir,
    fake: true,
    images: {
      directory: dir + '/images',
      tool: { output_format: 'png' },
      maxBytes: 1024,
    },
  })
  try {
    let id = await r.agent.start('no image from fake')
    await r.idle(id)
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('image configuration defaults to automatic with explicit disable and override', async () => {
  let { configuredImages } = await import('./images.ts')
  assertEquals(configuredImages(undefined, '')?.auto, true)
  assertEquals(configuredImages(undefined, '1')?.auto, false)
  assertEquals(configuredImages(undefined, '0'), undefined)
  assertEquals(configuredImages(false, '1'), undefined)
  assertEquals(configuredImages({}, '0')?.auto, undefined)
})

Deno.test('image disable crosses the worker boundary', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({ db: ':memory:', cwd: dir, fake: true, images: false })
  try {
    let id = await r.agent.start('disabled')
    await r.idle(id)
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})
