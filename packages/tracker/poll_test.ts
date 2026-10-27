// The Worker is a double at its doors: it pages its bugs by eid and records
// marks; which door a mark goes to is `marking`'s (./remote.ts). A poll that
// fails or hangs is asked through the signed transport, which is what names
// its failure.
import { clock, equal, test } from '@yaks/testing'
import { type Doors, poll, type Polled, signed } from './poll.ts'

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

// Signing and the failed response are the fixture. Await the subscriber, not
// a timer, and retain the observed failure after closing its owned poll.
let failedReports: unknown[] = []
let failed = await polled(poll(remote, '.bug', {
  doors: signed(
    remote,
    (() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch,
  ),
  report: (error) => failedReports.push(error),
}))
failed.close()
test('a failed poll is reported and leaves the answer not ready', () => {
  equal([failed.ready, failedReports.map(String)], [false, [
    'Error: Remote tracker refused the read (500)',
  ]])
})

test('a poll that hangs settles as failed, and says it timed out', async () => {
  let failures: unknown[] = []
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
    report: (error) => failures.push(error),
  }))
  await time.advance(5)
  let open = await hung
  equal([open.ready, failures.map(String)], [false, [
    'Error: Remote tracker did not answer in time',
  ]])
  open.close()
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
