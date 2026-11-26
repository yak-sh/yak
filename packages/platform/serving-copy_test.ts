// Serving-copy contracts at the synchronous persistence seam: no directory,
// runtime timers or Durable Object boot is needed to exercise revision races.
import { equal, ok, test } from '@yaks/testing'
import {
  LEASE,
  RETIRED,
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from './serving-copy.ts'

function fixture(initial?: ServingCopyState, maxAnswers?: number) {
  let snapshot = initial && JSON.stringify(initial)
  let reads = 0, writes = 0, fail = false
  let options = {
    maxAnswers,
    persistence: {
      read: (): ServingCopyState | undefined => {
        reads++
        return snapshot === undefined ? undefined : JSON.parse(snapshot)
      },
      write: (state: ServingCopyState) => {
        if (fail) throw new Error('disk unavailable')
        writes++
        snapshot = JSON.stringify(state)
      },
    },
  }
  return {
    copy: new ServingCopy(options),
    restart: () => new ServingCopy(options),
    stats: () => ({ reads, writes }),
    state: (): ServingCopyState | undefined =>
      snapshot === undefined ? undefined : JSON.parse(snapshot),
    fail: (value: boolean) => fail = value,
  }
}

function unavailable(copy: ServingCopy, key: string) {
  try {
    copy.get(key)
  } catch (error) {
    if (!(error instanceof ServingCopyUnavailable)) throw error
    equal(error.status, 503)
    return
  }
  throw new Error('Expected serving copy to be unavailable')
}

function diskFailure(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    equal(error.message, 'disk unavailable')
    return
  }
  throw new Error('Expected persistence failure')
}

test('serving copy: bootstrap zero accepts bodies, including empty deletion', () => {
  let f = fixture()
  equal(f.copy.revision, 0)
  equal(f.copy.put(0, 'app', 'body'), true)
  equal(f.copy.get('app'), 'body')
  equal(f.copy.put(0, 'app', ''), true)
  equal(f.copy.get('app'), '')
  // Bodies are held in memory: a restart begins empty.
  unavailable(f.restart(), 'app')
})

test('serving copy: warm reads do no persistence work', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'body')
  let before = f.stats()
  for (let n = 0; n < 20; n++) equal(f.copy.get('app'), 'body')
  equal(f.stats(), before)
})

test('serving copy: fills, misses, finishes and settles write nothing', () => {
  let f = fixture()
  unavailable(f.copy, 'cold')
  f.copy.put(0, 'warm', 'body')
  unavailable(f.copy, 'cold')
  let revision = f.copy.begin()
  let before = f.stats()
  f.copy.finish(revision)
  f.copy.put(revision, 'warm', 'body')
  f.copy.settle(f.copy.begin(), revision)
  f.copy.publish(revision, 'warm', 'again')
  equal(f.stats().writes - before.writes, 0)
})

test('serving copy: begin fences late fills and clears all previous answers', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'old')
  let late = f.copy.revision
  let revision = f.copy.begin()
  equal(revision, 1)
  unavailable(f.copy, 'app')
  equal(f.state(), { ceiling: 1 + LEASE })
  equal(f.copy.put(late, 'app', 'late'), false)
  equal(f.copy.put(revision, 'app', 'premature'), false)
  equal(f.copy.finish(revision), true)
  equal(f.copy.put(late, 'app', 'late'), false)
  unavailable(f.copy, 'app')
  equal(f.copy.put(revision, 'app', 'current'), true)
  equal(f.copy.get('app'), 'current')
})

test('serving copy: one saved ceiling grants LEASE fences', () => {
  let f = fixture()
  for (let n = 0; n < LEASE + 1; n++) f.copy.begin()
  equal(f.stats().writes, 1)
  f.copy.begin()
  equal([f.stats().writes, f.state()], [2, { ceiling: 2 + 2 * LEASE }])
})

test('serving copy: overlapping begins only finish the newest revision', () => {
  let f = fixture()
  let first = f.copy.begin(), second = f.copy.begin()
  equal([first, second], [1, 2])
  equal(f.copy.finish(first), false)
  equal(f.copy.finish(second + 1), false)
  equal(f.copy.put(second, 'app', 'blocked'), false)
  unavailable(f.copy, 'app')
  equal(f.copy.finish(second), true)
  f.copy.put(second, 'app', 'newest')
  equal(f.copy.finish(first), false)
  equal(f.copy.put(first, 'app', 'older'), false)
  equal(f.copy.get('app'), 'newest')
})

test('serving copy: a restart stands fenced above every fence it granted', () => {
  let f = fixture()
  let first = f.copy.begin()
  f.copy.finish(first)
  f.copy.put(first, 'app', 'old')
  let second = f.copy.begin()
  let restarted = f.restart()
  ok(restarted.revision > second)
  unavailable(restarted, 'app')
  equal(
    [
      restarted.valid(first),
      restarted.finish(first),
      restarted.finish(second),
      restarted.put(first, 'app', 'old'),
      restarted.publish(first, 'app', 'old'),
    ],
    [false, false, false, false, false],
  )
  // The directory, holding no fence, settles it at what it has committed.
  let mended = f.restart()
  ok(mended.settle(mended.revision, first))
  equal([mended.valid(first), mended.put(first, 'app', 'old')], [true, true])
})

test('serving copy: failed begin stays blocked and requires the caller to abort', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'old')
  f.fail(true)
  diskFailure(() => f.copy.begin())
  equal(f.copy.revision, 1)
  unavailable(f.copy, 'app')
  equal(f.copy.put(0, 'app', 'late'), false)
  f.fail(false)
  equal(f.copy.begin(), 2)
  equal(f.state(), { ceiling: 2 + LEASE })
})

test('serving copy: eviction follows fill order, not reads', () => {
  let f = fixture(undefined, 2)
  f.copy.put(0, 'a', 'A')
  f.copy.put(0, 'b', 'B')
  f.copy.get('a')
  f.copy.put(0, 'c', 'C')
  unavailable(f.copy, 'a')
  equal(f.copy.get('b'), 'B')
  equal(f.copy.get('c'), 'C')
  f.copy.put(0, 'b', 'replacement')
  f.copy.put(0, 'd', 'D')
  unavailable(f.copy, 'c')
  equal([f.copy.get('b'), f.copy.get('d')], ['replacement', 'D'])
})

test('serving copy: default bound evicts the oldest of 1000 answers', () => {
  let { copy } = fixture()
  for (let n = 0; n < 1000; n++) copy.put(0, String(n), 'body')
  copy.put(0, 'new', 'new body')
  unavailable(copy, '0')
  equal(copy.get('1'), 'body')
  equal(copy.get('new'), 'new body')
})

test('serving copy: configured bound must remain between one and 1000', () => {
  for (let maxAnswers of [0, -1, 1.5, 1001, NaN, Infinity]) {
    let caught = false
    try {
      fixture(undefined, maxAnswers)
    } catch (error) {
      ok(error instanceof RangeError)
      caught = true
    }
    ok(caught)
  }
})

test('serving copy: equal publication has no persistent warm cost', () => {
  let f = fixture()
  equal(f.copy.publish(0, 'private', 'body'), true)
  let before = f.stats()
  for (let i = 0; i < 100; i++) {
    equal(f.copy.publish(0, 'private', 'body'), true)
    equal(f.copy.valid(0), true)
    equal(f.copy.read('private'), { revision: 0, body: 'body' })
  }
  equal(f.stats(), before)
})

test('serving copy: settle finishes a committed fence, rewinds a rolled-back one, spares a newer one', () => {
  let { copy, restart } = fixture({ ceiling: 4 })
  let n = copy.begin()
  ok(copy.settle(n, n))
  ok(copy.valid(n))
  let m = copy.begin()
  ok(copy.settle(m, n))
  ok(copy.valid(n) && !copy.valid(m))
  let k = copy.begin()
  copy.begin()
  equal(copy.settle(k, n), false)
  equal(copy.valid(n), false)
  equal(restart().valid(k + 1), false)
})

test('serving copy: a retired copy answers nobody and no fence lowers it', () => {
  let f = fixture()
  let { copy } = f
  copy.put(0, '.app', 'body')
  let at = copy.begin()
  copy.begin(RETIRED - 1)
  let revision = copy.revision
  unavailable(copy, '.app')
  equal(
    [
      copy.finish(revision),
      copy.settle(revision, at),
      copy.publish(revision, '.app', 'body'),
      copy.valid(revision),
    ],
    [false, false, false, false],
  )
  unavailable(copy, '.app')
  // Retired, its ceiling is the last revision: it stays retired.
  let restarted = f.restart()
  equal(
    [restarted.revision, restarted.finish(RETIRED), restarted.valid(RETIRED)],
    [RETIRED, false, false],
  )
})
