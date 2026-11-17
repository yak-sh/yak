import { clock, equal, test, throws } from '@yaks/testing'
import { changes, type Doors, poll, type Polled, signed } from './poll.ts'
import { platform } from './remote.ts'

let heard = (open: Polled) =>
  new Promise<void>((done) => {
    let off = open.subscribe(() => {
      off()
      done()
    })
  })

test('an older tracker keeps discovery and bug polling until its change feed arrives', async () => {
  let time = clock(), upgraded = false, reads = 0, asks: string[] = []
  let scope = '00000000-0000-4000-8000-000000000001'
  let doors = signed(
    { url: 'https://tracker.invalid', secret: 'test-only' },
    ((url) => {
      let path = new URL(String(url)).pathname
      asks.push(path)
      return Promise.resolve(
        path == '/changes'
          ? upgraded
            ? Response.json({ scopes: [{ scope, tag: 'one' }] }, {
              headers: { etag: 'feed' },
            })
            : Response.json({ error: 'tracker route not found' }, {
              status: 404,
            })
          : path == '/scopes'
          ? Response.json({ scopes: [scope] })
          : (++reads, Response.json([])),
      )
    }) as typeof fetch,
  )
  let feed = changes(doors, { clock: time })
  let open = poll({}, '.bug', {
    scope,
    doors,
    version: feed.version,
    clock: time,
  })
  let pass = async () => {
    let done = heard(open)
    await time.advance(30_000)
    await done
  }
  try {
    await heard(open)
    equal(await feed.scopes(), [scope])
    equal([reads, open.ready], [1, true])
    await pass()
    equal(reads, 2)
    upgraded = true
    await pass()
    let held = reads
    equal(await feed.version(scope), 'one')
    await pass()
    equal(reads, held)
    equal(asks.filter((path) => path == '/scopes').length, 2)
  } finally {
    open.close()
    feed.close()
  }
})

test('a change feed keeps unrelated 404s and refused legacy discovery as failures', async () => {
  for (let error of ['bug not found', 'tracker route not found']) {
    let asks: string[] = []
    let doors = signed(
      { url: 'https://tracker.invalid', secret: 'test-only' },
      ((url) => {
        let path = new URL(String(url)).pathname
        asks.push(path)
        return Promise.resolve(Response.json({ error }, { status: 404 }))
      }) as typeof fetch,
    )
    let feed = changes(doors)
    try {
      let refused = await throws(() => feed.scopes())
      equal((refused as Error).message, 'Remote tracker refused the read (404)')
      equal((refused as Error).constructor, Error)
      equal(
        asks,
        error == 'bug not found' ? ['/changes'] : ['/changes', '/scopes'],
      )
    } finally {
      feed.close()
    }
  }
})

test('idle trackers share one feed read per interval, and only moved scopes read bugs', async () => {
  let time = clock(), reads = 0, feeds = 0, revision = 0
  let scopes = [platform, ...Array.from({ length: 121 }, (_, i) => `scope${i}`)]
  let doors: Doors = {
    changes: (held) => {
      feeds++
      return Promise.resolve(
        held == String(revision) ? { ok: true, tag: held, unchanged: true } : {
          ok: true,
          tag: String(revision),
          value: {
            scopes: scopes.map((scope) => ({
              scope,
              tag: scope == 'scope1' ? String(revision) : 'quiet',
            })),
          },
        },
      )
    },
    bugs: () => {
      reads++
      return Promise.resolve({ ok: true, value: [], tag: 'bugs' })
    },
    mark: () => Promise.resolve(),
  }
  let feed = changes(doors, { clock: time })
  let polls = scopes.map((scope) =>
    poll({}, '.bug', {
      scope,
      doors,
      version: feed.version,
      clock: time,
    })
  )
  let pass = () => Promise.all(polls.map(heard))
  try {
    await pass()
    equal([feeds, reads], [1, 122])
    for (let i = 0; i < 3; i++) {
      let done = pass()
      await time.advance(30_000)
      await done
    }
    equal([feeds, reads], [4, 122])
    revision++
    let done = pass()
    await time.advance(30_000)
    await done
    // A changed scope's conditional read falls back to one whole page here.
    equal([feeds, reads], [5, 124])
    equal((await feed.scopes()).length, 121)
  } finally {
    for (let open of polls) open.close()
    feed.close()
  }
})

test('a failed scope read retries the same feed version before acknowledging it', async () => {
  let time = clock(), reads = 0
  let open = poll({}, '.bug', {
    clock: time,
    version: () => Promise.resolve('one'),
    log: () => {},
    doors: {
      bugs: () =>
        Promise.resolve(
          ++reads == 1
            ? { ok: false, status: 503, error: 'unavailable' }
            : { ok: true, value: [] },
        ),
      mark: () => Promise.resolve(),
    },
  })
  try {
    await heard(open)
    equal(open.ready, false)
    let done = heard(open)
    await time.advance(30_000)
    await done
    equal([reads, open.ready], [2, true])
    done = heard(open)
    await time.advance(30_000)
    await done
    equal(reads, 2)
  } finally {
    open.close()
  }
})

test('work about a bug absent from a quiet scope costs no repeated reads there', async () => {
  let time = clock(), reads = 0, version = 'one'
  let open = poll({}, '.bug', {
    clock: time,
    version: () => Promise.resolve(version),
    doors: {
      bugs: () => {
        reads++
        return Promise.resolve({ ok: true, value: [] })
      },
      mark: () => Promise.resolve(),
    },
  })
  try {
    await heard(open)
    equal(reads, 1)
    for (let i = 0; i < 3; i++) equal(await open.get(['elsewhere']), [])
    equal(reads, 2)
    version = 'two'
    equal(await open.get(['elsewhere']), [])
    equal(reads, 3)
  } finally {
    open.close()
  }
})
