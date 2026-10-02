import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { cellsOf, chartbook } from './chartbook.ts'
import { pan, zoom } from './mapview.ts'

test('grown charts survive pan, zoom and reopening without loading terrain', async () => {
  let book = chartbook<string>(), painted = 0, loaded = 0
  let wide: [number, number, number] = [-256, -256, 1024]
  for (let cell of cellsOf(wide)) {
    await book.keep(cell, () => {
      painted++
      return cell.join(',')
    })
  }
  let near: [number, number, number] = [0, 0, 160]
  let read = (box: typeof near) =>
    book.read(box, () => true, () => {
      loaded++
      return Promise.resolve('missing')
    })
  for (let i = 0; i < 20; i++) {
    await read(pan(near, i / 100, -i / 100))
    await read(zoom(near, 2))
  }
  assertEquals((await read(wide))[0], {
    image: '-16,-16',
    box: [-256, -256, 16],
  })
  assertEquals([painted, loaded], [cellsOf(wide).length, 0])
  await book.keep([0, 0], () => {
    painted++
    return 'duplicate'
  })
  assertEquals(painted, cellsOf(wide).length)
  book.clear()
  await read(near)
  assertEquals(loaded, 100)
})

test('unexplored ground is never requested; overlapping requests share charts', async () => {
  let book = chartbook<string>(), calls: string[] = []
  let done = () => {}, ready = new Promise<void>((resolve) => done = resolve)
  let load = async (cell: [number, number]) => {
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
  let book = chartbook<string>(), fail = (_: Error) => {}
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
  assertEquals(cellsOf([-16, -16, 32]), [[-1, -1], [0, -1], [-1, 0], [0, 0]])
})
