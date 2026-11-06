// A store's schema receipt and request metadata, without its host lifecycle.
import { clock, equal, match, ok, test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { reported, type Tally, waited } from './lib/hops.ts'
import { fitOf, shapeOf, stands } from './store-schema.ts'
import { formatted } from './query-text.ts'

let CAKE = 'c0000000-0000-4000-8000-000000000003'
let SCHEMA = JSON.stringify({
  $defs: {
    recipe: { component: true, properties: { serves: { type: 'number' } } },
  },
})

// The same app after a deploy that added a word.
let GROWN = JSON.stringify({
  $defs: {
    ...JSON.parse(SCHEMA).$defs,
    dish: { properties: { n: { type: 'number' } } },
  },
})

// What a store raises out of each, as a wake does (`shapeOf`), and a graph in
// memory over each one's words.
let schemaShape = shapeOf('ada/cookbook', SCHEMA)
let grownShape = shapeOf('ada/cookbook', GROWN)
let over = ({ vocab }: typeof schemaShape) => {
  let words = loadVocab({
    $defs: Object.fromEntries(
      ['entity', 'recipe', 'dish'].flatMap((name) => {
        let definition = vocab.def(name)
        return definition ? [[name, definition]] : []
      }),
    ),
  })
  return graph({ vocab: words, storage: ram(words) })
}
let before = over(schemaShape), after = over(grownShape)
await after.apply([{
  entity: { eid: 'd0000000-0000-4000-8000-000000000004' },
  dish: { n: 0 },
}])

test('only the request that woke a store says how long it waited to start', () => {
  let time = clock(1000)
  let says = (waking: boolean) => {
    let tally: Tally = new Map()
    waited(tally, waking, 990, time.now())
    return reported(tally)['x-yak-wake']
  }
  equal(says(true), '10')
  equal(says(false), undefined)
})

test('a query tree sent as text is refused, never run as two words', () => {
  equal(formatted(String({})), '[object Object]')
  equal(formatted('[object Array]'), '[object Array]')
  equal(formatted('.recipe & [object Object]'), '[object Object]')
  equal(formatted('.recipe.title=[object] & .doc'), null)
})

test('a store wakes without its schema under the code that fitted it, and follows new words', () => {
  let fit = fitOf('a', schemaShape.key, 'stamp')
  ok(stands(fit, fitOf('a', schemaShape.key, 'stamp')))
  for (
    let moved of [
      fitOf('b', schemaShape.key, 'stamp'),
      fitOf('a', grownShape.key, 'stamp'),
      fitOf('a', schemaShape.key, 'new'),
    ]
  ) ok(!stands(fit, moved))
  ok(!stands(null, fitOf('a', schemaShape.key, null)))
  ok(!stands(null, fitOf(null, schemaShape.key, null)))
  equal(fitOf(null, schemaShape.key, 'stamp'), null)
})
let dish = [{ entity: { eid: CAKE }, dish: { n: 1 } }]
test('the old schema refuses a word it has not followed', () =>
  throws(() => before.apply(dish), /unknown component: dish/))
test('the followed schema takes a write in its new word', () =>
  match(after.apply(dish), [{ dish: { n: 1 } }]))
