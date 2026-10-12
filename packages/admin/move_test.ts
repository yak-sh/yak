import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { line, select, sweep } from './move.ts'

test('a store that fails is said, and the sweep goes on', async () => {
  let said: string[] = []
  let summary = await sweep({
    stores: ['a/x', 'b/y', 'directory'].map((at) => ({ store: at, at })),
    ask: (store) =>
      store == 'b/y' ? Promise.reject(new Error('503')) : Promise.resolve({
        store,
        rules: [{ mark: 'yak/store/now/1', rows: 3, moved: 3, batches: 1 }],
      }),
    pace: 0,
    out: (line) => said.push(line.replace(/ {2}\(\d+ms\)$/, '')),
    stopping: new AbortController().signal,
  })
  assertEquals(said, [
    'a/x  now/1  3 rows, 3 moved in 1 batches',
    'b/y  failed: 503',
    'directory  now/1  3 rows, 3 moved in 1 batches',
  ])
  assertEquals(summary.slice(0, 2), [
    '3 of 3 stores asked, 1 failed: b/y',
    '6 rows found',
  ])
})

test('a mover reports forwarded records apart from rows it visited', async () => {
  let rule = {
    mark: 'yak/store/forward/1' as const,
    rows: 5,
    moved: 5,
    batches: 1,
    forwarded: 2,
  }
  assertEquals(
    line('directory', rule),
    'directory  forward/1  5 rows, 5 moved in 1 batches, 2 forwarded',
  )
  assertEquals(
    line(
      'directory',
      {
        mark: rule.mark,
        live: true,
        moved: 5,
        forwarded: 2,
        done: 'now',
      },
    ),
    'directory  forward/1  done, 5 moved, 2 forwarded',
  )
  let failed = {
    mark: rule.mark,
    live: true,
    moved: 5,
    forwarded: 2,
    failed: 'queue unavailable',
  }
  assertEquals(
    line('directory', failed),
    'directory  forward/1  failed after 5: queue unavailable, 2 forwarded',
  )
  let summary = await sweep({
    stores: [{ store: 'directory', at: 'directory' }],
    ask: () => Promise.resolve({ store: 'directory', rules: [rule] }),
    pace: 0,
    out: () => {},
    stopping: new AbortController().signal,
  })
  assertEquals(summary.slice(0, 3), [
    '1 of 1 stores asked, 0 failed',
    '5 rows found',
    '2 records forwarded',
  ])
})

test('mover selection keeps a physical handle reachable after display deduplication', () => {
  let directory = { store: 'yak/platform', at: 'directory' }
  let app = { store: 'ada/notes.123456', at: 'ada/notes' }
  let stores = [app, directory]
  for (let where of ['directory', 'yak/platform', 'yak']) {
    assertEquals(select(stores, where), [directory])
  }
  for (let where of ['ada', 'ada/notes', 'ada/notes.123456']) {
    assertEquals(select(stores, where), [app])
  }
  assertEquals(select(stores), stores)
  assertEquals(select(stores, 'absent'), [])
})
