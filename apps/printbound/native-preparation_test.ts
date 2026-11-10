import { equal, ok, test } from '@yaks/testing'
import { assert } from '@std/assert'
import { advance, type Manifest, type Preparation, start } from './document.ts'
import { inspect } from './inspection.ts'
import { font } from './font_fixture.ts'
import { products } from './layout.ts'
import { nativeArtwork } from './native-artwork_fixture.ts'

let artwork = nativeArtwork()
test('native model artwork checkpoints each page at print resolution and retains source bytes', async () => {
  let blobs = new Map([['art', artwork], ['font', font]])
  let sourceReads = 0, sequence = 0
  let io = {
    read: (id: string) => {
      if (id == 'art') sourceReads++
      return Promise.resolve(ok(blobs.get(id)))
    },
    put: (bytes: Uint8Array) => {
      let id = String(++sequence)
      blobs.set(id, bytes)
      return Promise.resolve(id)
    },
    preview: () => {
      throw new Error('This proof stops before page previews')
    },
  }
  let state: Preparation | Manifest = start(products.coloring, {
    title: 'ABC',
    font: 'font',
    pages: Array.from({ length: 4 }, () => ({ blob: 'art' })),
    front: 'art',
    frontBleed: false,
  })
  for (let n = 1; n <= 4; n++) {
    sourceReads = 0
    state = await advance(JSON.parse(JSON.stringify(state)), io)
    assert(!('revision' in state))
    equal(sourceReads, 1)
    equal(state.parts.length, n)
    let [page] = await inspect(ok(blobs.get(state.parts.at(-1)!.blob)))
    equal(page.images.length, 1)
    equal(page.images[0].color, '/DeviceGray')
    ok(page.images[0].dpi >= 300)
    ok(
      Math.abs(page.images[0].width / page.images[0].height - 2400 / 3040) <
        .001,
    )
  }
  while (!('revision' in state) && !state.cover) {
    state = await advance(state, io)
  }
  assert(!('revision' in state) && state.cover)
  let [cover] = await inspect(ok(blobs.get(state.cover.blob)))
  equal(cover.images[0].color, '/DeviceRGB')
  ok(cover.images[0].dpi >= 300)
  equal(blobs.get('art'), artwork)
})
