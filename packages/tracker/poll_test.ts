// The Worker is a double at its doors: it pages its bugs by eid and records
// marks; which door a mark goes to is `marking`'s (./remote.ts). A poll that
// fails or hangs is asked through the signed transport, which is what names
// its failure.
import { clock, equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { type Doors, poll, type Polled, signed } from './poll.ts'
import type { Read } from './routes.ts'

let worker = (count: number) => {
  let bugs = Array.from({ length: count }, (_, i) => ({
    entity: { eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
    bug: { fault: `f${i}` },
  }))
  let marks: string[] = []
  let named: string[][] = []
  let doors: Doors = {
    bugs: (params) => {
      let query = params.get('query') ?? ''
      let after = query.match(/\.after=(\S+)/)?.[1] ?? ''
      let ids = query.match(/\.entity\.eid=(\S+)/)?.[1].split(',')
      if (ids) named.push(ids)
      let limit = Number(params.get('limit'))
      return Promise.resolve({
        ok: true,
        value: bugs.filter((b) =>
          b.entity.eid > after && (!ids || ids.includes(b.entity.eid))
        ).slice(0, limit),
      })
    },
    mark: (bug, name, said) => {
      marks.push([name, bug, ...Object.values(said)].join(' '))
      return Promise.resolve(true)
    },
  }
  return { doors, marks, bugs, named }
}
let remote = { url: 'https://tracker.example', secret: 'test' }

// The poll once it has answered or failed, as its subscribers hear it.
let polled = (open: Polled) =>
  new Promise<Polled>((done) => {
    let off = open.subscribe(() => {
      off()
      done(open)
    })
  })

let pagedWorker = worker(230)
test('a poll answers every page of the platform tracker, and marks reach it', async () => {
  let { doors, marks } = pagedWorker
  let open = await polled(poll(remote, '.bug', { doors }))
  equal(open.value.length, 230)
  await open.mutate([
    { entity: { eid: 'a' }, resolved: { at: 'now', cause: 'race' } },
    { entity: { eid: 'b' }, archived: {} },
    { entity: { eid: 'c' }, doc: { title: 'no mark' } },
    { entity: { eid: 'd' }, taken: { task: 'T-7' } },
  ])
  equal(marks, ['resolved a race', 'archived b', 'taken d T-7'])
  open.close()
})

let named = worker(230)
let namedPoll = poll(remote, '.bug.status=open', { doors: named.doors })
let namedBugs = named.bugs.slice(0, 150)
let namedGot = await namedPoll.get([
  ...namedBugs.map((b) => b.entity.eid),
  'gone',
])
namedPoll.close()
test('a poll reads bugs by id whatever its query, a page of ids to a request', () => {
  equal(namedGot, namedBugs)
  equal(named.named.map((ids) => ids.length), [100, 51])
})

// Signing and the refused response are the fixture: a refusal of what was
// asked is a bug at once, and a tracker that cannot answer for now a log line.
// Await the subscriber, not a timer.
let through = async (status: number) => {
  let filed: string[] = [], logged: string[] = []
  let go = () => Promise.resolve(new Response('', { status }))
  let open = await polled(poll(remote, '.bug', {
    doors: signed(remote, go as typeof fetch),
    report: (error) => filed.push(String(error)),
    log: (line) => logged.push(line),
  }))
  open.close()
  return [open.ready, filed, logged]
}
let refusedRead = await through(400), busyRead = await through(503)
test('a refused read is reported at once, and a busy tracker is logged', () => {
  equal(refusedRead, [
    false,
    ['Error: Remote tracker refused the read (400)'],
    [],
  ])
  equal(busyRead, [false, [], [
    'Remote tracker refused the read (503); polling again every 30 s',
  ]])
})

test('a poll that hangs settles as failed, and says it timed out', async () => {
  let filed: unknown[] = [], logged: string[] = []
  let time = clock()
  // A fetch that never answers, until its signal gives up on it.
  let hang = ((_: unknown, init?: RequestInit) =>
    new Promise((_, fail) => {
      let signal = init!.signal!
      if (signal.aborted) fail(signal.reason)
      signal.addEventListener('abort', () => fail(signal.reason))
    })) as typeof fetch
  let hung = polled(poll(remote, '.bug', {
    timeout: 5,
    timer: (fn, ms) => time.after(ms, fn),
    doors: signed(remote, hang),
    report: (error) => filed.push(error),
    log: (line) => logged.push(line),
  }))
  await time.advance(5)
  let open = await hung
  equal([open.ready, filed, logged], [false, [], [
    'Remote tracker did not answer in time; polling again every 30 s',
  ]])
  open.close()
})

// What a poll on a held clock files and logs over its polls, 30 s apart, the
// Worker answering each as `said` says: by a name below, or a thrown failure.
let replies: Record<string, Read> = {
  ok: { ok: true, value: [] },
  invalid: { ok: true, value: 'not a page' },
  refused: {
    ok: false,
    error: 'Remote tracker refused the read (400)',
    status: 502,
  },
  busy: {
    ok: false,
    error: 'Remote tracker refused the read (503)',
    status: 503,
  },
  late: {
    ok: false,
    error: 'Remote tracker did not answer in time',
    status: 504,
  },
}
let polls = async (...said: (string | Error)[]) => {
  let time = clock(), filed: string[] = [], logged: string[] = []
  let left = [...said]
  let resting = Promise.withResolvers<void>()
  let open = poll(remote, '.bug', {
    timer: (fn, ms) => {
      if (ms == 30_000) resting.resolve()
      return time.after(ms, fn)
    },
    doors: {
      bugs: () => {
        let next = left.shift() ?? 'ok'
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(replies[next])
      },
      mark: () => Promise.resolve(),
    },
    report: (error) => {
      let { cause } = error as Error
      filed.push(`${time.now() / 1000} s ${error}${cause ? ` (${cause})` : ''}`)
    },
    log: (line) => logged.push(line),
  })
  for (let _ of said) {
    await resting.promise
    resting = Promise.withResolvers()
    await time.advance(30_000)
  }
  open.close()
  return { filed, logged }
}
let times = (n: number, said: string) => Array<string>(n).fill(said)

test('a poll that fails and recovers files nothing, and logs both', async () => {
  equal(await polls('busy', 'late', 'ok'), {
    filed: [],
    logged: [
      'Remote tracker refused the read (503); polling again every 30 s',
      'Remote tracker answered again after 2 failed polls',
    ],
  })
})

test('a tracker that stays unanswered is filed once, five minutes in', async () => {
  equal((await polls(...times(12, 'late'))).filed, [
    '300 s Error: Remote tracker has not answered for 5 minutes (Error: Remote tracker did not answer in time)',
  ])
})

test('an answer restarts the five minutes', async () => {
  equal((await polls(...times(9, 'busy'), 'ok', ...times(10, 'busy'))).filed, [
    '600 s Error: Remote tracker has not answered for 5 minutes (Error: Remote tracker refused the read (503))',
  ])
})

test('a poll that never settles is unanswered too', async () => {
  let time = clock(), filed: unknown[] = []
  let open = poll(remote, '.bug', {
    timer: (fn, ms) => time.after(ms, fn),
    doors: { bugs: () => new Promise(() => {}), mark: () => Promise.resolve() },
    report: (error) => filed.push(String(error)),
  })
  await time.advance(300_000)
  open.close()
  equal(filed, ['Error: Remote tracker has not answered for 5 minutes'])
})

test('any other failed poll is filed at once', async () => {
  let failed = Error('Remote tracker poll worker failed')
  equal((await polls('refused', 'invalid', failed, 'ok')).filed, [
    '0 s Error: Remote tracker refused the read (400)',
    '30 s Error: Remote tracker returned an invalid page of bugs',
    '60 s Error: Remote tracker poll worker failed',
  ])
})

// A Worker that tags its answer: a poll holding the tag is told nothing moved.
let tags = worker(150)
let sent: (string | undefined)[] = []
let quiet = poll(remote, '.bug', {
  every: 0,
  doors: {
    ...tags.doors,
    bugs: async (params, signal, tag) => {
      sent.push(tag)
      return tag == '"t1"'
        ? { ok: true, tag, unchanged: true }
        : { ...await tags.doors.bugs(params, signal), tag: '"t1"' }
    },
  },
})
let heard = await new Promise<number[]>((done) => {
  let lengths: number[] = []
  let off = quiet.subscribe((value) => {
    lengths.push(value.length)
    if (lengths.length == 3) off(), done(lengths)
  })
})
quiet.close()
test('a poll sends the tag of the answer it holds, and keeps that answer while nothing moves', () => {
  equal(heard, [150, 150, 150])
  equal(sent.slice(0, 4), [undefined, undefined, '"t1"', '"t1"'])
})

// A Worker that names what moved since a tag it knows, and then stops knowing.
let moving = worker(150)
let at = 1, knows = true, moves = new Map<string, number>()
let asks: string[] = []
let eid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
let renewing = poll(remote, '.bug', {
  every: 0,
  doors: {
    ...moving.doors,
    bugs: async (params, signal, tag) => {
      let now = `"t${at}"`
      if (tag == now) return { ok: true, tag, unchanged: true }
      if (params.has('since')) {
        asks.push('since')
        let m = Number(tag!.slice(2, -1))
        let moved = [...moves].filter(([, n]) => n > m).map(([e]) => e)
        return { ok: true, tag: now, value: { moved: knows ? moved : null } }
      }
      asks.push(params.get('query')!.includes('.entity.eid=') ? 'id' : 'page')
      return { ...await moving.doors.bugs(params, signal), tag: now }
    },
  },
})
let answers = await new Promise<Bundle[][]>((done) => {
  let seen: Bundle[][] = []
  let off = renewing.subscribe((value) => {
    seen.push(value)
    if (seen.length == 1) {
      at = 2
      moving.bugs[3].bug.fault = 'moved'
      moving.bugs.splice(7, 1)
      moving.bugs.push({ entity: { eid: eid(999) }, bug: { fault: 'new' } })
      for (let i of [3, 7, 999]) moves.set(eid(i), 2)
    }
    if (seen.length == 2) at = 3, knows = false
    if (seen.length == 4) off(), done(seen)
  })
})
renewing.close()

test('a poll holding a tag reads again only the bugs that moved since', () => {
  equal(asks, ['page', 'page', 'since', 'id', 'since', 'page', 'page'])
  equal(answers[1], moving.bugs)
})

test('a poll whose tag the Worker no longer knows reads whole', () => {
  equal(answers.slice(2), [moving.bugs, moving.bugs])
})
