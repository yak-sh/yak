// Quoted bundle JSON must reach the CLI intact; unmatched quotes must not run.
import { equal, match, test, throws } from '@yaks/testing'
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

test('site and playground use the same UUID for every book example', async () => {
  const page = await Deno.readTextFile(new URL('./index.html', import.meta.url))
  const source = await Deno.readTextFile(
    new URL('./playground.js', import.meta.url),
  )
  const id = source.match(/eid: '([^']+)'/)![1]
  match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  // Hero bundle, patch command and initial visible card all name the seeded book.
  equal(page.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g), [
    id,
    id,
    id,
  ])
  equal(source.includes("eid: '$"), false)
  equal(page.includes('book:dune'), false)
  equal(source.includes('eid: mint()'), true)
})
