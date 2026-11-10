// Source artwork and public seed paths use the same verified byte-copy seam.
import { equal, test } from '@yaks/testing'
import { sha256 } from '@yaks/graph'
import { copyAssets } from './venture-assets.ts'

let bytes = new TextEncoder().encode('fixture artwork')
let stored = new Map<string, Uint8Array>()
let writes = 0
let port = {
  read: (_key: string) => Promise.resolve(bytes),
  get: (hash: string) => Promise.resolve(stored.get(hash)),
  put: (hash: string, data: Uint8Array) => {
    writes++
    stored.set(hash, data.slice())
    return Promise.resolve()
  },
}
let objects = [{
  key: 'private/reference.png',
  bytes: bytes.byteLength,
  hash: sha256(bytes),
}]
await copyAssets(objects, port)

test('An asset copy is byte-verified, deduplicated and stable across private and public source keys', async () => {
  let map = await copyAssets([...objects, {
    key: '/coloring-pages/fixture.png',
    hash: sha256(bytes),
  }], port)
  equal(map[objects[0].key], sha256(bytes))
  equal(map['/coloring-pages/fixture.png'], sha256(bytes))
  equal(writes, 1)
})

test('A destination that drops bytes cannot report a successful asset migration', async () => {
  let error = await copyAssets(objects, {
    ...port,
    get: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
  }).then(() => '', (e) => e.message)
  equal(error, 'Destination asset digest mismatch')
})

test('Changed source bytes cannot silently replace the artifact named by a manifest', async () => {
  let error = await copyAssets(objects, {
    ...port,
    read: () => Promise.resolve(new Uint8Array([1])),
  }).then(() => '', (e) => e.message)
  equal(error, 'Source asset size mismatch')
})
