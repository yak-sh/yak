import { equal, test } from '@yaks/testing'
import { searchBoard } from './search.ts'

test('canvas turns a local search link into a live board, not foreign pages', () => {
  equal(
    searchBoard('https://tasks.test/?q=fleet%20.task', 'https://tasks.test'),
    {
      doc: { title: 'fleet .task', body: '' },
      board: { query: 'fleet .task' },
    },
  )
  equal(
    searchBoard('https://foreign.test/?q=fleet', 'https://tasks.test'),
    null,
  )
  equal(
    searchBoard('https://tasks.test/T-1?q=fleet', 'https://tasks.test'),
    null,
  )
  equal(searchBoard('https://tasks.test/?q=', 'https://tasks.test'), null)
})
