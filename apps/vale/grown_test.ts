// Exercise the page's growth boundary without meshing a world or starting a
// browser. Worker replies carry the same already-grown patch as gameplay.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { flat, vale } from './terrain.ts'
import { chartPatch } from './chart.ts'
import { seedThemes } from './themes_fixture.ts'
import type { Chunk } from './chunks.ts'
import type { Answer, Ask } from './grow.ts'

seedThemes()

test('gameplay charts survive terrain eviction and reload asks the worker once', async () => {
  let WorkerWas = globalThis.Worker
  let chartAsks = 0, grown = flat(8, [], [], 0.25).grow(0, 0)
  class Hand {
    onmessage: ((e: { data: Answer }) => void) | null = null
    postMessage(a: Ask & { n: number }) {
      if (!('n' in a)) return
      let answer: Answer
      if ('chart' in a) {
        chartAsks++
        answer = { n: a.n, px: chartPatch(grown) }
      } else {
        answer = {
          n: a.n,
          drawn: { patch: grown, stood: [] } as unknown as Chunk,
        }
      }
      queueMicrotask(() => this.onmessage?.({ data: answer }))
    }
  }
  globalThis.Worker = Hand as unknown as typeof Worker
  let v = vale(), growWas = v.grow, patchesWas = v.patches
  v.patches = new Map()
  v.grow = () => {
    throw new Error('map must not regrow ground on the page')
  }
  try {
    // Each test gets its own pool, apart from the app's module singleton.
    let page = await import('./grown.ts?chart-test')
    await page.meshed(0.25, 0, 0, true)
    let first = await page.groundCharts([0, 0])
    assertEquals(first, chartPatch(grown))
    v.patches.clear()
    assertEquals(await page.groundCharts([0, 0]), first)
    assertEquals(chartAsks, 0)
    let a = page.groundCharts([1, 0]), b = page.groundCharts([1, 0])
    assertEquals(await a, await b)
    assertEquals(chartAsks, 1)
  } finally {
    globalThis.Worker = WorkerWas
    v.grow = growWas
    v.patches = patchesWas
  }
})
