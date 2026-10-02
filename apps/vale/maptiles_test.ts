import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { atlas, cellsOf, pyramid, TILE_SIZES } from './maptiles.ts'
import { type Box, pan, zoom } from './mapview.ts'

test('panning, zooming and reopening charted ground paint no new charts', async () => {
  let calls: string[] = []
  let ground = atlas((cell, version) => {
    calls.push(`${version}/${cell}`)
    return Promise.resolve(TILE_SIZES.map((size) => `${cell}/${size}`))
  })
  let wide: Box = [-256, -256, 1024]
  await ground(wide, 1)
  let charted = calls.length
  let near: Box = [0, 0, 320]
  for (let i = 0; i < 20; i++) {
    let moved = pan(near, i / 100, -i / 100)
    await ground(moved, 1)
    await ground(zoom(moved, 1.3), 1)
  }
  await ground(wide, 1)
  assertEquals(calls.length, charted)
  assertEquals(new Set(calls).size, charted)
  let tiles = await ground(near, 2)
  assertEquals(calls.length - charted, cellsOf(near).length)
  assertEquals(tiles[0], { image: '0,0/256', box: [0, 0, 256] })
})

test('overlapping pending views share cells and a failed tile can retry', async () => {
  let calls = 0, release: () => void = () => {}
  let ready = new Promise<void>((done) => release = done)
  let ground = atlas(async () => {
    calls++
    await ready
    return TILE_SIZES.map(String)
  })
  let a = ground([0, 0, 320], 0), b = ground([8, 8, 320], 0)
  release()
  await Promise.all([a, b])
  assertEquals(calls, 4)
  let tries = 0
  let flaky = atlas(() => {
    if (++tries == 1) return Promise.reject(new Error('missing image'))
    return Promise.resolve(TILE_SIZES.map(String))
  })
  await assertRejects(() => flaky([0, 0, 256], 0))
  assertEquals((await flaky([0, 0, 256], 0))[0].image, '256')
  assertEquals(tries, 2)
})

test('tile placement covers negative coordinates without extra boundary cells', () => {
  assertEquals(cellsOf([-256, -256, 512]), [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ])
})

test('pyramid levels average the detailed chart without painting terrain', () => {
  let px = new Uint8ClampedArray(256 * 256 * 4)
  for (let z = 0; z < 256; z++) {
    for (let x = 0; x < 256; x++) {
      px.set([x, z, 80, 255], (x + z * 256) * 4)
    }
  }
  let levels = pyramid(px)
  assertEquals(levels.map((level) => Math.sqrt(level.length / 4)), TILE_SIZES)
  assertEquals(Array.from(levels[1].slice(0, 4)), [1, 1, 80, 255])
  assertEquals(Array.from(levels[1].slice(-4)), [255, 255, 80, 255])
  assertEquals(Array.from(levels[3].slice(0, 4)), [4, 4, 80, 255])
})
