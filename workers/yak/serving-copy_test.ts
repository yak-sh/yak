// Serving-copy contracts at the synchronous persistence seam: no directory,
// runtime timers or Durable Object boot is needed to exercise revision races.
import { equal, ok, test } from '@yaks/testing'
import {
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
  equal(f.restart().get('app'), '')
})

test('serving copy: warm reads do no persistence work', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'body')
  let before = f.stats()
  for (let n = 0; n < 20; n++) equal(f.copy.get('app'), 'body')
  equal(f.stats(), before)
})

test('serving copy: misses never register cold keys or write snapshots', () => {
  let f = fixture()
  let before = f.stats()
  unavailable(f.copy, 'cold')
  unavailable(f.copy, 'another')
  equal(f.stats(), before)
  equal(f.state(), undefined)
  f.copy.put(0, 'warm', 'body')
  unavailable(f.copy, 'cold')
  equal(f.state()?.answers, [['warm', 'body']])
})

test('serving copy: begin fences late fills and clears all previous answers', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'old')
  let late = f.copy.revision
  let revision = f.copy.begin()
  equal(revision, 1)
  unavailable(f.copy, 'app')
  equal(f.state(), { revision: 1, blocked: true, answers: [] })
  equal(f.copy.put(late, 'app', 'late'), false)
  equal(f.copy.put(revision, 'app', 'premature'), false)
  equal(f.copy.finish(revision), true)
  equal(f.copy.put(late, 'app', 'late'), false)
  unavailable(f.copy, 'app')
  equal(f.copy.put(revision, 'app', 'current'), true)
  equal(f.copy.get('app'), 'current')
})

test('serving copy: overlapping begins only finish the newest revision', () => {
  let f = fixture()
  let first = f.copy.begin(), second = f.copy.begin()
  equal([first, second], [1, 2])
  let before = f.stats()
  equal(f.copy.finish(first), false)
  equal(f.copy.finish(second + 1), false)
  equal(f.copy.put(second, 'app', 'blocked'), false)
  equal(f.stats(), before)
  unavailable(f.copy, 'app')
  equal(f.copy.finish(second), true)
  f.copy.put(second, 'app', 'newest')
  equal(f.copy.finish(first), false)
  equal(f.copy.put(first, 'app', 'older'), false)
  equal(f.copy.get('app'), 'newest')
})

test('serving copy: restart retains a blocked fence and rejects prior epochs', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'old')
  let revision = f.copy.begin()
  let restarted = f.restart()
  equal(restarted.revision, revision)
  unavailable(restarted, 'app')
  equal(restarted.finish(0), false)
  equal(restarted.put(0, 'app', 'old'), false)
  equal(restarted.put(revision, 'app', 'blocked'), false)
  equal(restarted.finish(revision), true)
  unavailable(restarted, 'app')
  restarted.put(revision, 'app', 'new')
  equal(f.restart().get('app'), 'new')
  equal(f.restart().begin(), revision + 1)
})

test('serving copy: matching finish is idempotent and persists before unblocking', () => {
  let f = fixture()
  let revision = f.copy.begin()
  f.fail(true)
  diskFailure(() => f.copy.finish(revision))
  unavailable(f.copy, 'app')
  unavailable(f.restart(), 'app')
  f.fail(false)
  equal(f.copy.finish(revision), true)
  f.copy.put(revision, 'app', 'body')
  let before = f.stats()
  equal(f.copy.finish(revision), true)
  equal(f.stats(), before)
  equal(f.copy.get('app'), 'body')
})

test('serving copy: failed begin stays blocked and requires the caller to abort', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'old')
  f.fail(true)
  diskFailure(() => f.copy.begin())
  equal(f.copy.revision, 1)
  unavailable(f.copy, 'app')
  equal(f.copy.put(0, 'app', 'late'), false)
  // No directory mutation may commit after begin throws; the durable body is old.
  equal(f.restart().get('app'), 'old')
  f.fail(false)
  equal(f.copy.begin(), 2)
  unavailable(f.restart(), 'app')
})

test('serving copy: successful replacement is durable, failure preserves it', () => {
  let f = fixture()
  f.copy.put(0, 'app', 'old')
  equal(f.copy.put(0, 'app', 'replacement'), true)
  equal(f.copy.get('app'), 'replacement')
  equal(f.restart().get('app'), 'replacement')
  f.fail(true)
  diskFailure(() => f.copy.put(0, 'app', 'not durable'))
  equal(f.copy.get('app'), 'replacement')
  equal(f.restart().get('app'), 'replacement')
  unavailable(f.copy, 'missing')
})

test('serving copy: eviction follows fill order, not reads, across restart', () => {
  let f = fixture(undefined, 2)
  f.copy.put(0, 'a', 'A')
  f.copy.put(0, 'b', 'B')
  f.copy.get('a')
  f.copy.put(0, 'c', 'C')
  unavailable(f.copy, 'a')
  equal(f.copy.get('b'), 'B')
  equal(f.copy.get('c'), 'C')
  let restarted = f.restart()
  restarted.put(0, 'b', 'replacement')
  restarted.put(0, 'd', 'D')
  unavailable(restarted, 'c')
  equal(f.state()?.answers, [['b', 'replacement'], ['d', 'D']])
})

let fullCopy = (() => {
  let answers: [string, string][] = Array.from(
    { length: 1000 },
    (_, n) => [String(n), 'body'],
  )
  let saved: ServingCopyState | undefined
  let copy = new ServingCopy({
    persistence: {
      read: () => ({ revision: 7, blocked: false, answers }),
      write: (state) => saved = state,
    },
  })
  copy.put(7, 'new', 'new body')
  return { copy, saved }
})()
test('serving copy: default bound evicts the oldest of 1000 restored answers', () => {
  unavailable(fullCopy.copy, '0')
  equal(fullCopy.copy.get('1'), 'body')
  equal(fullCopy.copy.get('new'), 'new body')
  equal(fullCopy.saved?.answers.length, 1000)
})

test('serving copy: a smaller bound trims restored bodies without writing on read', () => {
  let f = fixture({
    revision: 3,
    blocked: false,
    answers: [['a', 'A'], ['b', 'B'], ['c', 'C']],
  }, 2)
  unavailable(f.copy, 'a')
  equal(f.copy.get('b'), 'B')
  equal(f.stats(), { reads: 1, writes: 0 })
  f.copy.put(3, 'd', 'D')
  equal(f.state()?.answers, [['c', 'C'], ['d', 'D']])
})

test('serving copy: persistence cannot mutate live answers by retaining a snapshot', () => {
  let saved: ServingCopyState | undefined
  let copy = new ServingCopy({
    persistence: {
      read: () => saved,
      write: (state) => saved = state,
    },
  })
  copy.put(0, 'app', 'body')
  saved!.answers[0][1] = 'changed outside'
  saved!.blocked = true
  equal(copy.get('app'), 'body')
  saved = { revision: 8, blocked: false, answers: [['app', 'restored']] }
  let restored = new ServingCopy({
    persistence: { read: () => saved, write: () => {} },
  })
  saved.answers[0][1] = 'changed after read'
  equal(restored.get('app'), 'restored')
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
