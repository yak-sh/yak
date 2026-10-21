import { equal, test } from '@yaks/testing'
import { put, write } from './state.ts'

// What a write from `at` leaves said when its apply fails with `error`.
let said = async (error: unknown) => {
  let set: unknown[] = []
  await write(
    {
      apply: () => Promise.reject(error),
      set: (bs) => void set.push(...bs),
    },
    'T-1 head',
    [],
  )
  return set
}

test('a refused write is said where it was made', async () =>
  equal(
    await said(
      Object.assign(Error('doc T-1 has moved'), { outcome: 'refused' }),
    ),
    put({ said: 'doc T-1 has moved', at: 'T-1 head' }),
  ))

test('a write whose outcome is unknown, the server away, says nothing', async () =>
  equal(
    await said(Object.assign(Error('write outcome unknown: Failed to fetch'), {
      outcome: 'unknown',
    })),
    put({ said: null, at: null }),
  ))
