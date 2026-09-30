import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { sweep } from './move.ts'

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
