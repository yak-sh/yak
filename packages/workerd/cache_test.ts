import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { purging, sharedBytes, stored, storedBytes, through } from './cache.ts'

let publicAnswer = (body = 'bytes') =>
  new Response(body, { headers: { 'cache-control': 'public, max-age=30' } })

test('an immutable index is shared after it exists, including its bytes', async () => {
  let files = new Map<string, Response>(), writes: Promise<void>[] = []
  let cache = {
    match: (req: Request) => Promise.resolve(files.get(req.url)?.clone()),
    put: (req: Request, res: Response) =>
      Promise.resolve(void files.set(req.url, res)),
  }
  let index = 'https://files.invalid/release-index/1'
  let bytes = Uint8Array.of(0, 128, 255)
  let read = (
    key: string,
    draw: () => Promise<Uint8Array<ArrayBuffer> | null>,
  ) =>
    storedBytes(cache, key, draw, {
      hold: (work) => writes.push(work),
      failed: (error) => {
        throw error
      },
    })
  assertEquals(await read(index, () => Promise.resolve(null)), null)
  assertEquals(await read(index, () => Promise.resolve(bytes)), bytes)
  await Promise.all(writes)
  assertEquals(await read(index, () => Promise.reject('cache miss')), bytes)
  assertEquals(await read(index + '2', () => Promise.resolve(null)), null)
})

test('a shared cache answers an immutable read before the bucket is asked', async () => {
  let bytes = Uint8Array.of(0, 128, 255)
  let actual = await sharedBytes(
    { fetch: () => Promise.resolve(new Response(bytes)) },
    'https://shared.invalid/1',
    () => Promise.reject('bucket was asked'),
    { hold: () => {}, failed: () => {} },
  )
  assertEquals(actual, bytes)
})

test('the bucket can answer while the shared cache is filling', async () => {
  let time = clock(), ready = Promise.withResolvers<Response>()
  let held: Promise<void>[] = [], reads = 0
  let bytes = Uint8Array.of(23)
  let answer = sharedBytes(
    { fetch: () => ready.promise },
    'https://shared.invalid/1',
    () => (reads++, Promise.resolve(bytes)),
    { hold: (work) => held.push(work), failed: () => {}, clock: time },
  )
  await time.advance(25)
  assertEquals(await answer, bytes)
  assertEquals(reads, 1)
  ready.resolve(new Response(bytes))
  await Promise.all(held)
})

test('a cache fill never holds a miss or another reader behind it', async () => {
  let filling = Promise.withResolvers<void>()
  let pending: Promise<void>[] = []
  let reads = 0, puts = 0
  let cache = {
    match: () => Promise.resolve(undefined),
    put: () => (puts++, filling.promise),
  }
  let draw = () => (reads++, Promise.resolve(publicAnswer()))
  let options = {
    hold: (work: Promise<void>) => pending.push(work),
    failed: (error: unknown) => {
      throw error
    },
  }
  try {
    let first = await stored(cache, asked(), draw, options)
    let second = await stored(cache, asked(), draw, options)
    assertEquals(await first.text(), 'bytes')
    assertEquals(await second.text(), 'bytes')
    assertEquals([reads, puts], [2, 2])
  } finally {
    filling.resolve()
    await Promise.all(pending)
  }
})

test('a cached whole response answers GET, HEAD and ranges at one key', async () => {
  let methods: string[] = []
  let range: string | null = null
  let cache = {
    match: (req: Request) => {
      methods.push(req.method)
      range = req.headers.get('range')
      return Promise.resolve(
        range ? new Response('yt', { status: 206 }) : publicAnswer(),
      )
    },
    put: () => Promise.reject(new Error('a hit never fills')),
  }
  let options = {
    hold: (_work: Promise<void>) => {},
    failed: (error: unknown) => {
      throw error
    },
  }
  let draw = () => Promise.reject(new Error('a hit never draws'))
  for (let method of ['GET', 'HEAD']) {
    let response = await stored(
      cache,
      new Request(asked(), { method }),
      draw,
      options,
    )
    assertEquals(await response.text(), method == 'HEAD' ? '' : 'bytes')
    assertEquals(response.headers.get('cf-cache-status'), 'HIT')
  }
  let part = await stored(
    cache,
    new Request(asked(), { headers: { range: 'bytes=1-2' } }),
    draw,
    options,
  )
  assertEquals(await said(part), [206, 'yt'])
  assertEquals([methods, range], [['GET', 'GET', 'GET'], 'bytes=1-2'])
})

test('only public whole reads fill the cache and failures still answer', async () => {
  let pending: Promise<void>[] = [],
    failures: unknown[] = [],
    puts: number[] = []
  let options = {
    hold: (work: Promise<void>) => pending.push(work),
    failed: (error: unknown) => {
      failures.push(error)
    },
  }
  let cache = {
    match: () => Promise.resolve(undefined),
    put: (_req: Request, res: Response) => {
      puts.push(res.status)
      return res.body!.cancel()
    },
  }
  for (
    let [status, control] of [
      [200, 'public, max-age=30'],
      [404, 'public, max-age=30'],
      [404, 'private, no-store'],
      [503, 'public, max-age=30'],
      [206, 'public, max-age=30'],
      [200, 'public, no-store'],
    ] as const
  ) {
    let res = await stored(cache, asked(), () =>
      Promise.resolve(
        new Response('answer', {
          status,
          headers: { 'cache-control': control },
        }),
      ), options)
    assertEquals(await res.text(), 'answer')
  }
  await Promise.all(pending)
  assertEquals(puts, [200, 404])
  let broken = new Error('cache unavailable')
  let failing = {
    match: () => Promise.reject(broken),
    put: () => Promise.reject(broken),
  }
  let res = await stored(
    failing,
    asked(),
    () => Promise.resolve(publicAnswer()),
    options,
  )
  assertEquals(await res.text(), 'bytes')
  await Promise.all(pending)
  assertEquals(failures, [broken, broken])
  let unopened = await stored(
    () => Promise.reject(broken),
    asked(),
    local,
    options,
  )
  assertEquals(await unopened.text(), 'in-process')
  assertEquals(failures, [broken, broken, broken])
})

test('a cache that holds a match back is read around, and not filled', async () => {
  let time = clock()
  let late = Promise.withResolvers<Response | undefined>()
  let puts = 0, failures: unknown[] = []
  let cache = {
    match: () => late.promise,
    put: () => (puts++, Promise.resolve()),
  }
  let pending: Promise<void>[] = []
  let draw = () => Promise.resolve(publicAnswer('drawn'))
  let answer = stored(cache, asked(), draw, {
    hold: (work) => pending.push(work),
    failed: (error) => failures.push(error),
    clock: time,
    patience: 500,
  })
  await time.advance(500)
  assertEquals(await said(await answer), [200, 'drawn'])
  let cancelled = Promise.withResolvers<void>()
  let body = new ReadableStream({ cancel: () => cancelled.resolve() })
  late.resolve(new Response(body))
  await cancelled.promise
  await Promise.all(pending)
  assertEquals([puts, failures], [0, []])
  assertEquals(time.pending(), 0)
})

test('writes, credentials and no-store reads never open a shared cache', async () => {
  let opens = 0
  let open = () => (opens++, Promise.reject(new Error('cache should not open')))
  let options = {
    hold: (_work: Promise<void>) => {},
    failed: (_error: unknown) => {},
  }
  for (
    let init of [
      { method: 'POST', body: 'write' },
      { headers: { authorization: 'Bearer test' } },
      { cache: 'no-store' as const },
    ]
  ) {
    let res = await stored(open, new Request(asked(), init), local, options)
    assertEquals(await res.text(), 'in-process')
  }
  assertEquals(opens, 0)
})

test('a filled response is reused only for its tenant and query key', async () => {
  let entries = new Map<string, Response>(), pending: Promise<void>[] = []
  let reads = 0
  let cache = {
    match: (req: Request) => Promise.resolve(entries.get(req.url)?.clone()),
    put: (req: Request, res: Response) => {
      entries.set(req.url, res)
      return Promise.resolve()
    },
  }
  let options = {
    hold: (work: Promise<void>) => pending.push(work),
    failed: (error: unknown) => {
      throw error
    },
  }
  let draw = () => Promise.resolve(publicAnswer(String(++reads)))
  let get = async (path: string) => {
    let res = await stored(
      cache,
      new Request(`https://files.invalid/${path}`),
      draw,
      options,
    )
    await Promise.all(pending)
    return res.text()
  }
  assertEquals(await get('tenant-a/file?g=4'), '1')
  assertEquals(await get('tenant-a/file?g=4'), '1')
  assertEquals(await get('tenant-b/file?g=4'), '2')
  assertEquals(await get('tenant-a/file?g=5'), '3')
})

let asked = () => new Request('https://files.invalid/a/style.css')
let local = () => Promise.resolve(new Response('in-process'))
let cache = (answer: () => Response) => ({
  fetch: () => Promise.resolve().then(answer),
})
let said = async (res: Response) => [res.status, await res.text()]

test('the cache answers what it can, and the process the rest', async () => {
  let failed: number[] = []
  let heard = { failed: (res: Response) => failed.push(res.status) }
  let clone = () => {
    throw Object.assign(new Error('no'), { name: 'DataCloneError' })
  }
  let cases: [ReturnType<typeof cache> | undefined, (string | number)[]][] = [
    [undefined, [200, 'in-process']],
    [cache(() => new Response('kept')), [200, 'kept']],
    [cache(() => new Response('gone', { status: 404 })), [404, 'gone']],
    [cache(() => new Response(null, { status: 522 })), [200, 'in-process']],
    [cache(clone), [200, 'in-process']],
  ]
  for (let [bound, want] of cases) {
    assertEquals(await said(await through(bound, asked(), local, heard)), want)
  }
  assertEquals(failed, [522])
})

test('a read the cache holds back past its patience is answered in-process', async () => {
  let time = clock()
  let signals: AbortSignal[] = []
  let stalled = {
    fetch: (
      req: Request,
    ) => (signals.push(req.signal), new Promise<Response>(() => {})),
  }
  let held: number[] = []
  let answer = through(stalled, asked(), local, {
    clock: time,
    patience: 5_000,
    held: (_, ms) => held.push(ms),
  })
  await time.advance(4_000)
  assertEquals(held, [])
  await time.advance(1_000)
  assertEquals(await said(await answer), [200, 'in-process'])
  assertEquals([held, signals.map((s) => s.aborted)], [[5_000], [true]])
  assertEquals(time.pending(), 0)
})

test('a read held back while its origin fails too is not blamed on the cache', async () => {
  let held: number[] = []
  let stalled = { fetch: () => new Promise<Response>(() => {}) }
  let read = (local: () => Promise<Response>) => {
    let time = clock()
    let answer = through(stalled, asked(), local, {
      clock: time,
      patience: 5_000,
      held: (_, ms) => held.push(ms),
    })
    return time.advance(5_000).then(() => answer)
  }
  let busy = () => Promise.reject(new Error('BucketUnavailable'))
  await assertRejects(() => read(busy), Error, 'BucketUnavailable')
  assertEquals(
    (await read(() => Promise.resolve(new Response(null, { status: 500 }))))
      .status,
    500,
  )
  assertEquals(held, [])
})

test('a failure the cache cannot be read around is thrown', async () => {
  let broken = cache(() => {
    throw new TypeError('bad')
  })
  await assertRejects(() => through(broken, asked(), local), TypeError)
})

test('an entrypoint purges through its lent cache, and with none refuses', async () => {
  let sent: string[][] = []
  let lent = {
    purge: ({ tags }: { tags: string[] }) => {
      sent.push(tags)
      return Promise.resolve({ success: true, errors: [] })
    },
  }
  assertEquals(await purging(lent)(['app:a']), { success: true, errors: [] })
  assertEquals(sent, [['app:a']])
  assertEquals((await purging()(['app:a'])).success, false)
})
