// The one-time snapshot reads an app Store as the kernel and seals what the
// old schema still knows before the new builder vocabulary is installed.
import { assertEquals, assertRejects } from '@std/assert'
import { r2Objects } from './lib/objects.ts'
import { bucket } from './testing.ts'
import { valeSnapshot } from './vale_sfx_snapshot.ts'

Deno.test('a private Vale Store snapshot keeps legacy builder fields', async () => {
  let app = '0f562744-e91e-4958-bfb7-1ef06af52dc2'
  let rows: Record<string, unknown[]> = {
    '.builder&*': [
      { entity: { eid: 'z' }, builder: { model: 'seed' } },
      { entity: { eid: 'a' }, builder: { model: 'seed' } },
    ],
    '.build&*': [{ entity: { eid: 'run' }, build: { inputs: ['sound'] } }],
    '.built&*': [{ entity: { eid: 'output' }, built: { artifact: 'audio' } }],
    '.sfx&*': [{ entity: { eid: 'sound' }, sfx: { name: 'water' } }],
    '.artifact&*': [{ entity: { eid: 'audio' }, artifact: { address: 'sha' } }],
    '.cites&*': [{ entity: { eid: 'cite' }, edge: { from: 'output' } }],
  }
  let seen: string[] = []
  let store = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (request: Request) => {
        let url = new URL(request.url)
        seen.push(request.headers.get('x-yak-kernel') ?? '')
        return Promise.resolve(Response.json(
          url.pathname == '/query'
            ? rows[url.searchParams.get('q') ?? ''] ?? []
            : url.pathname == '/vocab'
            ? { $defs: { sfx: { description: 'old' } } }
            : { from: 'bookmark' },
        ))
      },
    }),
  }
  let blobs = bucket()
  let dir = {
    personAt: () => Promise.resolve('admin'),
    appAt: () =>
      Promise.resolve({
        space: { eid: 'space', slug: 'yourname' },
        app: { eid: app, slug: 'vale', store: 'yourname/vale.f52dc2' },
      }),
  }
  let ctx = { person: 'admin', dir, env: { STORE: store, BLOBS: blobs.r2 } }
  let checked = await valeSnapshot.run(ctx as never, { app, check: true })
  assertEquals(checked.value?.outputs, 1)
  let said = await valeSnapshot.run(ctx as never, { app })
  assertEquals(said.value?.builders, 2)
  let raw = r2Objects(blobs.r2 as never)
  let bytes = await raw.get(
    `audit/vale-sfx-44666/stores/${app}.json`,
  )
  let proof = await raw.get(
    `audit/vale-sfx-44666/stores/${app}.seal.json`,
  )
  let saved = JSON.parse(new TextDecoder().decode(bytes))
  let sealed = JSON.parse(new TextDecoder().decode(proof))
  assertEquals(
    saved.builders.map((row: { entity: { eid: string } }) => row.entity.eid),
    ['a', 'z'],
  )
  assertEquals(saved.builders[0].builder.model, 'seed')
  assertEquals(saved.builds[0].build.inputs, ['sound'])
  assertEquals(saved.artifacts.length, 1)
  assertEquals(saved.citations.length, 1)
  assertEquals(sealed.app, app)
  assertEquals(sealed.store, 'yourname/vale.f52dc2')
  assertEquals(sealed.counts, {
    builders: 2,
    builds: 1,
    outputs: 1,
    sounds: 1,
    artifacts: 1,
    citations: 1,
  })
  rows['.builder&*'].reverse()
  assertEquals(
    (await valeSnapshot.run(ctx as never, { app })).value?.sha,
    sealed.sha,
  )
  await raw.put(
    `audit/vale-sfx-44666/stores/${app}.seal.json`,
    new TextEncoder().encode(JSON.stringify({ ...sealed, counts: {} })),
  )
  await assertRejects(() => valeSnapshot.run(ctx as never, { app }))
  await raw.put(
    `audit/vale-sfx-44666/stores/${app}.seal.json`,
    proof,
  )
  await raw.put(
    `audit/vale-sfx-44666/stores/${app}.json`,
    new TextEncoder().encode(JSON.stringify({ ...saved, at: 'changed' })),
  )
  await assertRejects(() => valeSnapshot.run(ctx as never, { app }))
  assertEquals(seen.every((header) => header == '1'), true)
})
