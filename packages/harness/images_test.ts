import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { local } from './local.ts'
import { images } from './images.ts'
import { responses } from '@yaks/openai'
import { responses as router } from '@yaks/openrouter'
import { artifactStore, fileBlobs, memoryBlobs } from '@yaks/blob'
import { routes as blobRoutes } from '@yaks/blob/routes'
import { compose } from '@yaks/cli/host'
import { identityEid } from '@yaks/graph'
import { remote } from './remote.ts'
import { hosted } from './store.ts'
import { at, harness, worker } from './testing.ts'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='

test('the harness and blob door share the graph artifact store', async () => {
  let dir = await Deno.makeTempDir()
  try {
    for (let custom of [false, true]) {
      let db = `${dir}/${custom ? 'custom' : 'default'}.db`
      let place = `${dir}/${custom ? 'media' : 'images'}`
      let config = at(db)
      if (custom) {
        config.plugins = config.plugins!.map((p) =>
          p == '@yaks/blob'
            ? { use: p, with: { store: { via: 'file', dir: place } } }
            : p
        )
      }
      let host = await compose(config, ['graph'])
      try {
        let h = hosted(host)
        let bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
        let artifact = await artifactStore(h.artifacts)(bytes, 'image/png')
        await h.g.apply([{ entity: { eid: artifact.address }, artifact }])
        let get = blobRoutes(host).find((r) => r.method == 'GET')!
        let redirect = await get.handle(
          new Request(`http://host/blob/${artifact.address}`),
        )
        assertEquals(redirect.status, 302)
        let response = await get.handle(
          new Request(redirect.headers.get('location')!),
        )
        assertEquals(response.status, 200)
        assertEquals(response.headers.get('content-type'), 'image/png')
        assertEquals(new Uint8Array(await response.arrayBuffer()), bytes)
        assertEquals(await Deno.readFile(`${place}/${artifact.address}`), bytes)
      } finally {
        await host.close()
      }
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('generated artifacts survive database reopen and keep payloads out of transcript and requests', async () => {
  let dir = await Deno.makeTempDir()
  let db = dir + '/graph.db', directory = dir + '/images'
  let h = await harness(db)
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
    images: images(h.artifacts),
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
  let a = local({ h, cwd: dir, model, name: 'gpt-4.1', tools: [] })
  try {
    let id = await a.start('draw')
    await a.idle(id)
    let entries = await a.transcript(id)
    assertEquals(entries.filter((e) => e.attachment).length, 2)
    assert(!JSON.stringify(entries).includes(png))
    let artifacts = await a.h.g.read('.artifact&*')
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
    await a.close()
    let again = await harness(db)
    try {
      assertEquals((await again.g.read('.artifact&*')).length, 1)
    } finally {
      again.close()
    }
  } finally {
    // close is idempotent at the driver boundary; all model turns are idle.
    await a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

test('host store failure returns no artifact and retry repairs partial bytes', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let store = images(fileBlobs(dir)).store
    let bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    let first = await store(bytes, 'image/png')
    await Deno.writeFile(dir + '/' + first.address, bytes.slice(0, 2))
    assertEquals(await store(bytes, 'image/png'), first)
    assertEquals(await Deno.readFile(dir + '/' + first.address), bytes)
    await Deno.writeTextFile(dir + '/not-dir', 'file')
    await assertRejects(() =>
      images(fileBlobs(dir + '/not-dir')).store(bytes, 'image/png')
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('a model row sends OpenRouter audio to the graph as an artifact', async () => {
  let h = await harness(':memory:')
  let bytes = new TextEncoder().encode('ID3music')
  let data = btoa(String.fromCharCode(...bytes))
  let model = router({
    key: () => 'test',
    media: { store: artifactStore(h.artifacts) },
    fetch: (_url, init) => {
      let request = JSON.parse(String(init?.body))
      assertEquals(request.modalities, ['text', 'audio'])
      return Promise.resolve(
        new Response(
          'data: ' + JSON.stringify({
            id: 'song-1',
            choices: [{
              delta: { audio: { data, transcript: 'Forest theme' } },
            }],
          }) + '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    },
  })
  let a = local({
    h,
    provider: 'openrouter',
    name: 'google/lyria-3-clip-preview',
    providers: { openrouter: model },
    tools: [],
  })
  try {
    await h.g.apply([{
      entity: {
        eid: identityEid('model', ['google/lyria-3-clip-preview']),
      },
      model: {
        name: 'google/lyria-3-clip-preview',
        modalities: ['text', 'audio'],
      },
    }])
    let id = await a.start('Music for a quiet forest')
    await a.idle(id)
    let artifacts = await h.g.read('.artifact&*')
    assertEquals(artifacts.length, 1)
    let artifact = artifacts[0].artifact as {
      address: string
      media_type: string
      size: number
    }
    assertEquals(artifact.media_type, 'audio/mpeg')
    assertEquals(await h.artifacts.get(artifact.address), bytes)
    assert((await a.transcript(id)).some((e) => e.attachment))
  } finally {
    await a.close()
  }
})

test('image options cross the worker boundary without serializing callbacks', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({
    worker: worker(),
    config: at(),
    cwd: dir,
    fake: true,
    images: {
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

test('image configuration defaults to enabled with explicit disable and override', async () => {
  let { configuredImages } = await import('./images.ts')
  let blobs = memoryBlobs()
  assertEquals(typeof configuredImages(blobs, undefined, '')?.store, 'function')
  assertEquals(
    typeof configuredImages(blobs, undefined, '1')?.store,
    'function',
  )
  assertEquals(configuredImages(blobs, undefined, '0'), undefined)
  assertEquals(configuredImages(blobs, false, '1'), undefined)
  assertEquals(configuredImages(blobs, {}, '0')?.auto, undefined)
})

test('image disable crosses the worker boundary', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({
    worker: worker(),
    config: at(':memory:'),
    cwd: dir,
    fake: true,
    images: false,
  })
  try {
    let id = await r.agent.start('disabled')
    await r.idle(id)
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})
