// The ambient tally (hops.ts): a hop counts on the tally that is running, the
// header rolls the bucket's verbs into one number, and a nested tally is its
// own. A read is made once a request, until the request writes to the store it
// read, and never outlives the request.
import { assertEquals, assertRejects } from '@std/assert'
import { counts, hop, recall, type Tally, tallying, writing } from './hops.ts'

Deno.test('a hop counts on the tally that is running, and nowhere else', () => {
  let tally: Tally = new Map()
  // Outside every `tallying`, a hop is a no-op — a seam called by a script,
  // a boot, or a test is not a request and has nobody to report to.
  hop('hops')
  assertEquals(tally.size, 0)
  tallying(tally, () => {
    hop('hops')
    hop('hops')
    hop('r2.get')
    hop('r2.put', 3)
  })
  // The header's two numbers: store hops as they were named, and every `r2.*`
  // verb summed, since what a caller spent is how many times the bucket was
  // asked and not which verb asked it.
  assertEquals(counts(tally), { hops: 2, r2: 4 })
  hop('hops')
  assertEquals(counts(tally).hops, 2)
})

Deno.test('a nested tally is the inner one, and the outer resumes', () => {
  let outer: Tally = new Map()
  let inner: Tally = new Map()
  tallying(outer, () => {
    hop('hops')
    tallying(inner, () => hop('hops'))
    hop('hops')
  })
  assertEquals([counts(outer).hops, counts(inner).hops], [2, 1])
})

// A store read that answers how many times it has been asked.
let asking = () => {
  let asked = 0
  return () => recall('ada/notes', '/vocab', () => Promise.resolve(++asked))
}
let wrote = (store: string) => writing(store, () => Promise.resolve())

Deno.test('a request reads once, until it writes to what it read', async () => {
  let read = asking()
  await tallying(new Map(), async () => {
    assertEquals([await read(), await read()], [1, 1])
    await wrote('ada/other')
    assertEquals(await read(), 1)
    await wrote('ada/notes')
    assertEquals([await read(), await read()], [2, 2])
  })
  // Another request asks for itself, and outside every request it is a read.
  await tallying(new Map(), async () => assertEquals(await read(), 3))
  assertEquals([await read(), await read()], [4, 5])
})

Deno.test('a read made while a write is in flight is not the answer after it', async () => {
  let read = asking()
  let done = () => {}
  await tallying(new Map(), async () => {
    let write = writing('ada/notes', () => new Promise<void>((r) => done = r))
    assertEquals(await read(), 1)
    done()
    await write
    assertEquals(await read(), 2)
  })
})

Deno.test('a fresh asking takes only a fresh answer, which answers every asking after it', async () => {
  let asked = 0
  let read = (fresh = false) =>
    recall('ada/notes', '/vocab', () => Promise.resolve(++asked), fresh)
  await tallying(new Map(), async () => {
    assertEquals([await read(), await read(true), await read()], [1, 2, 2])
    assertEquals(await read(true), 2)
  })
})

Deno.test('a request remembers nothing once it has finished', async () => {
  let read = asking()
  let later: Promise<number[]> | undefined
  await tallying(new Map(), async () => {
    await read()
    later = new Promise((done) =>
      setTimeout(async () => done([await read(), await read()]))
    )
  })
  assertEquals(await later, [2, 3])
})

Deno.test('a read that failed is asked again', async () => {
  let asked = 0
  let read = () =>
    recall(
      'ada/notes',
      '/vocab',
      () =>
        ++asked == 1
          ? Promise.reject(new Error('gone'))
          : Promise.resolve(asked),
    )
  await tallying(new Map(), async () => {
    await assertRejects(read, Error, 'gone')
    assertEquals(await read(), 2)
  })
})
