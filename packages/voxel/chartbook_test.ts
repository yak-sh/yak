import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { type Cell, cellsOf, chartbook, type ChartBox } from './chartbook.ts'

test('kept charts survive changed views and reopening without reloading', async () => {
  let book = chartbook<string>(16), painted = 0, loaded = 0
  let wide: ChartBox = [-32, -32, 96]
  for (let cell of cellsOf(wide, 16)) {
    await book.keep(cell, () => {
      painted++
      return cell.join(',')
    })
  }
  let near: ChartBox = [0, 0, 32]
  let read = (box: typeof near) =>
    book.read(box, () => true, () => {
      loaded++
      return Promise.resolve('missing')
    })
  for (let i = 0; i < 4; i++) {
    await read([-5 * i, 5 * i, 32])
    await read([-16, -16, 64])
  }
  assertEquals((await read(wide))[0], {
    image: '-2,-2',
    box: [-32, -32, 16],
  })
  assertEquals([painted, loaded], [cellsOf(wide, 16).length, 0])
  await book.keep([0, 0], () => {
    painted++
    return 'duplicate'
  })
  assertEquals(painted, cellsOf(wide, 16).length)
  book.clear()
  await read(near)
  assertEquals(loaded, 4)
})

test('unexplored ground is never requested; overlapping requests share charts', async () => {
  let book = chartbook<string>(16), calls: string[] = []
  let done = () => {}, ready = new Promise<void>((resolve) => done = resolve)
  let load = async (cell: Cell) => {
    calls.push(cell.join(','))
    await ready
    return cell.join(',')
  }
  assertEquals(await book.read([0, 0, 32], () => false, load), [])
  assertEquals(calls, [])
  let a = book.read([0, 0, 32], ([ci]) => ci == 0, load)
  let b = book.read([8, 0, 32], ([ci]) => ci == 0, load)
  done()
  await Promise.all([a, b])
  assertEquals(calls, ['0,0', '0,1'])
})

test('a failed chart retries and a retired failure cannot evict its replacement', async () => {
  let book = chartbook<string>(16), fail = (_: Error) => {}
  let pending = book.keep(
    [0, 0],
    () => new Promise<string>((_, reject) => fail = reject),
  )
  await Promise.resolve()
  book.clear()
  await book.keep([0, 0], () => 'replacement')
  fail(new Error('old chart'))
  await assertRejects(() => pending)
  assertEquals(await book.keep([0, 0], () => 'wrong'), 'replacement')
  book.clear()
  await assertRejects(() =>
    book.keep([0, 0], () => {
      throw new Error('chart')
    })
  )
  assertEquals(await book.keep([0, 0], () => 'retried'), 'retried')
})

test('chart placement covers negative coordinates without extra boundary cells', () => {
  assertEquals(cellsOf([-16, -16, 32], 16), [[-1, -1], [0, -1], [-1, 0], [
    0,
    0,
  ]])
})

test('chartbooks use the supplied chunk size for cells, placement and reuse', async () => {
  let book = chartbook<string>(5), loaded: Cell[] = []
  let load = (cell: Cell) => {
    loaded.push(cell)
    return Promise.resolve(cell.join(','))
  }
  assertEquals(cellsOf([-5, -5, 10], 5), [[-1, -1], [0, -1], [-1, 0], [0, 0]])
  assertEquals(await book.read([-5, -5, 10], () => true, load), [
    { image: '-1,-1', box: [-5, -5, 5] },
    { image: '0,-1', box: [0, -5, 5] },
    { image: '-1,0', box: [-5, 0, 5] },
    { image: '0,0', box: [0, 0, 5] },
  ])
  assertEquals(await book.read([0, 0, 5], () => true, load), [
    { image: '0,0', box: [0, 0, 5] },
  ])
  assertEquals(loaded, [[-1, -1], [0, -1], [-1, 0], [0, 0]])
})
