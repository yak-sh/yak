// Quoted bundle JSON must reach the CLI intact; unmatched quotes must not run.
import { equal, test, throws } from '@yaks/testing'
import { words } from './playground.js'

test('playground keeps quoted bundle JSON in one argument', () => {
  equal(words(`graph apply --change '[{"book":{"title":"A long title"}}]'`), [
    'graph',
    'apply',
    '--change',
    '[{"book":{"title":"A long title"}}]',
  ])
  equal(words(`graph query ""`), ['graph', 'query', ''])
})

test('playground refuses an unclosed quoted command', () => {
  throws(() => words("graph query '.book"))
})
