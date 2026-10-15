// All directory waits run against a controlled clock: no wall-clock sleeps.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  DirectoryCopy,
  type DirectoryCopyState,
  DirectoryCopyUnavailable,
} from './directory-copy.ts'

let flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

let fixture = () => {
  let time = clock()
  let reads = 0, writes = 0
  let state: DirectoryCopyState | undefined
  let failure = false
  let timers = new Set<() => void>()
  let retained: Promise<void>[] = []
  let options = {
    persistence: {
      read: () => {
        reads++
        return state && structuredClone(state)
      },
      write: (next: DirectoryCopyState) => {
        writes++
        if (failure) throw new Error('disk unavailable')
        state = structuredClone(next)
      },
    },
    timer: {
      now: time.now,
      after: (ms: number, callback: () => void) => {
        timers.add(callback)
        let cancel = time.after(ms, () => {
          timers.delete(callback)
          callback()
        })
        return () => {
          timers.delete(callback)
          cancel()
        }
      },
    },
    retain: (promise: Promise<void>) => {
      retained.push(promise)
    },
    freshForMs: 100,
  }
  let copy = new DirectoryCopy(options)
  return {
    copy,
    restart: () => new DirectoryCopy(options),
    stats: () => ({
      reads,
      writes,
      timers: timers.size,
      retained: retained.length,
    }),
    state: () => structuredClone(state),
    fail: (value: boolean) => failure = value,
    drain: () => Promise.all(retained),
    advance: async (ms: number) => {
      await time.advance(ms)
      await flush()
    },
  }
}

let never = () => new Promise<string>(() => {})
let unavailable = (promise: Promise<string>) =>
  assertRejects(() => promise, DirectoryCopyUnavailable)

test('directory copy: fresh warm hits do no persistence work or load', async () => {
  let f = fixture()
  assertEquals(await f.copy.query('app', () => Promise.resolve('old')), 'old')
  let before = f.stats()
  assertEquals(
    await f.copy.query('app', () => {
      throw new Error('must not load')
    }),
    'old',
  )
  assertEquals(f.stats(), before)
  assertEquals(f.copy.keys(), ['app'])
  assertEquals(f.stats().timers, 0)
})

test('directory copy: never-answer stale row returns at exactly 25ms', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('stale'))
  await f.advance(100)
  let settled = false
  let answer = f.copy.query('app', never).then((body) => {
    settled = true
    return body
  })
  await f.advance(24)
  assertEquals(settled, false)
  await f.advance(1)
  assertEquals(await answer, 'stale')
  assertEquals(f.stats().timers, 0)
})

test('directory copy: cold directory wait is bounded and remains registered', async () => {
  let f = fixture()
  let answer = unavailable(f.copy.query('cold', never))
  assertEquals(f.copy.keys(), ['cold'])
  await f.advance(25)
  let error = await answer
  assertEquals(error.status, 503)
  assertEquals(f.restart().keys(), ['cold'])
})

test('directory copy: stale readers dedupe a retained load beyond timeout', async () => {
  let f = fixture(), calls = 0
  await f.copy.query('app', () => Promise.resolve('stale'))
  await f.advance(100)
  let held = Promise.withResolvers<string>()
  let load = () => {
    calls++
    return held.promise
  }
  let first = f.copy.query('app', load)
  let second = f.copy.query('app', load)
  await f.advance(25)
  assertEquals(await first, 'stale')
  assertEquals(await second, 'stale')
  let third = f.copy.query('app', load)
  await f.advance(25)
  assertEquals(await third, 'stale')
  assertEquals(calls, 1)
  assertEquals(f.stats().retained, 2)
  held.resolve('new')
  await f.drain()
  assertEquals(await f.copy.query('app', never), 'new')
})

test('directory copy: refresh within 25ms wins and cancels timeout', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('old'))
  await f.advance(100)
  let held = Promise.withResolvers<string>()
  let answer = f.copy.query('app', () => held.promise)
  await f.advance(24)
  held.resolve('fresh')
  assertEquals(await answer, 'fresh')
  assertEquals(f.stats().timers, 0)
})

test('directory copy: rejection is retained, stale survives and retry is possible', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('stale'))
  await f.advance(100)
  assertEquals(
    await f.copy.query('app', () => Promise.reject('offline')),
    'stale',
  )
  assertEquals(
    await f.copy.query('app', () => {
      throw new Error('synchronous load failure')
    }),
    'stale',
  )
  await f.drain()
  assertEquals(
    await f.copy.query('app', () => Promise.resolve('recovered')),
    'recovered',
  )
})

test('directory copy: cold load failure fails closed without waiting', async () => {
  let f = fixture()
  await unavailable(f.copy.query('cold', () => Promise.reject('offline')))
  await f.drain()
  assertEquals(f.stats().timers, 0)
})

test('directory copy: deploy fence persists and publication replaces all bodies', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('old release'))
  await f.copy.query('settings', () => Promise.resolve('old setting'))
  let revision = f.copy.fence()
  assertEquals(revision, 1)
  assertEquals(f.state()?.blocked, true)
  await unavailable(f.copy.query('app', never))
  await unavailable(f.restart().query('settings', never))
  assertEquals(
    f.copy.publish(
      revision,
      new Map([
        ['app', 'new release'],
        ['settings', 'new setting'],
      ]),
    ),
    true,
  )
  let restored = f.restart()
  assertEquals(await restored.query('app', never), 'new release')
  assertEquals(await restored.query('settings', never), 'new setting')
  assertEquals(f.state()?.blocked, false)
})

test('directory copy: deletion publishes an empty answer, never the old row', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('[{"id":"old"}]'))
  assertEquals(f.copy.publish(f.copy.fence(), [['app', '']]), true)
  assertEquals(await f.copy.query('app', never), '')
  assertEquals(await f.restart().query('app', never), '')
})

test('directory copy: incomplete publication and late revisions stay blocked', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('old'))
  let first = f.copy.fence(), current = f.copy.fence()
  assertEquals(f.copy.publish(first, [['app', 'wrong']]), false)
  assertEquals(f.copy.publish(current, []), false)
  await unavailable(f.copy.query('registered while blocked', never))
  assertEquals(f.copy.keys(), ['app', 'registered while blocked'])
  assertEquals(f.copy.publish(current, [['app', 'incomplete']]), false)
  await unavailable(f.copy.query('app', never))
  assertEquals(
    f.copy.publish(current, [
      ['app', 'new'],
      ['registered while blocked', '[]'],
    ]),
    true,
  )
})

test('directory copy: fence wakes waiting readers, which never return stale', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('stale'))
  await f.advance(100)
  let answer = unavailable(f.copy.query('app', never))
  f.copy.fence()
  await answer
  assertEquals(f.stats().timers, 0)
})

test('directory copy: pre-fence cold fill cannot resurrect a deleted result', async () => {
  let f = fixture(), held = Promise.withResolvers<string>()
  let answer = unavailable(f.copy.query('app', () => held.promise))
  await flush()
  let revision = f.copy.fence()
  assertEquals(f.copy.publish(revision, [['app', '[]']]), true)
  held.resolve('[{"id":"deleted"}]')
  await f.drain()
  await answer
  assertEquals(await f.copy.query('app', never), '[]')
  assertEquals(await f.restart().query('app', never), '[]')
})

test('directory copy: an obsolete refresh cannot overwrite or clear a new fill', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('old'))
  await f.advance(100)
  let old = Promise.withResolvers<string>()
  let oldAnswer = unavailable(f.copy.query('app', () => old.promise))
  await flush()
  let revision = f.copy.fence()
  f.copy.publish(revision, [['app', 'published']])
  await oldAnswer
  await f.advance(100)
  let fresh = Promise.withResolvers<string>(), calls = 0
  let load = () => {
    calls++
    return fresh.promise
  }
  let answer = f.copy.query('app', load)
  old.resolve('obsolete')
  await flush()
  let deduped = f.copy.query('app', load)
  await flush()
  assertEquals(calls, 1)
  fresh.resolve('latest')
  assertEquals(await answer, 'latest')
  assertEquals(await deduped, 'latest')
  assertEquals(await f.restart().query('app', never), 'latest')
})

test('directory copy: fence and publish storage failures fail closed', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('old'))
  let revision = f.copy.fence()
  f.fail(true)
  assertThrows(
    () => f.copy.publish(revision, [['app', 'new']]),
    Error,
    'disk unavailable',
  )
  await unavailable(f.copy.query('app', never))
  await unavailable(f.restart().query('app', never))
  assertThrows(() => f.copy.fence(), Error, 'disk unavailable')
  await unavailable(f.copy.query('app', never))
})

test('directory copy: a timed-out cold fill can populate the next warm read', async () => {
  let f = fixture(), held = Promise.withResolvers<string>()
  let answer = unavailable(f.copy.query('cold', () => held.promise))
  await f.advance(25)
  await answer
  held.resolve('late but current')
  await f.drain()
  assertEquals(await f.copy.query('cold', never), 'late but current')
  assertEquals(await f.restart().query('cold', never), 'late but current')
})

test('directory copy: a failed fill snapshot preserves the old durable answer', async () => {
  let f = fixture()
  await f.copy.query('app', () => Promise.resolve('old'))
  await f.advance(100)
  f.fail(true)
  assertEquals(
    await f.copy.query('app', () => Promise.resolve('not durable')),
    'old',
  )
  await f.drain()
  f.fail(false)
  assertEquals(f.state()?.answers[0][1]?.body, 'old')
})
