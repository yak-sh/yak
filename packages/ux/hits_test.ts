import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { pickLine } from './hits.ts'

// Every line a picker sends must parse: the trap is a presence filter with a
// trailing term ('.person ali'), which the grammar refuses.
test('a picker line always parses', () => {
  for (
    let [q, comp] of [
      ['T-3'],
      [''],
      ['ali', 'person'],
      ['', 'person'],
      ['widget line', 'task'],
      ['.task.status=open', 'task'],
    ]
  ) parse(pickLine(q, comp))
})
