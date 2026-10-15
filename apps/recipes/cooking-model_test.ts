import { equal, test, throws } from '@yaks/testing'
import {
  cookingIngredients,
  formatSeconds,
  ownsSession,
  parseDuration,
  refId,
  roundRobin,
  snapshotSession,
  timerChange,
  timerRemaining,
  validSeconds,
} from './cooking-model.js'

const recipes = () => [
  {
    eid: 'soup',
    title: 'Soup',
    ingredients: ['Stock', 'Carrots', 'Salt'],
    steps: ['Chop', 'Simmer 10–15 minutes', 'Serve'],
  },
  {
    eid: 'bread',
    title: 'Bread',
    ingredients: ['Flour', 'Water'],
    steps: ['Mix', 'Bake for half an hour'],
  },
]

test('Cooking interleaves unequal recipe lists and preserves empty or duplicate entries', () => {
  equal(roundRobin([['a', 'a', ''], [], ['b']]), ['a', 'b', 'a', ''])
  equal(roundRobin([]), [])
  const { bundles, eid } = snapshotSession(recipes())
  const steps = bundles.filter((r) => 'cook_step' in r)
  equal(steps.map((r) => r.cook_step?.text), [
    'Chop',
    'Mix',
    'Simmer 10–15 minutes',
    'Bake for half an hour',
    'Serve',
  ])
  equal(steps.map((r) => r.cook_step?.ord), [0, 1, 2, 3, 4])
  equal(steps.every((r) => r.cook_step?.session === eid), true)
  equal(steps.map((r) => r.cook_step?.seconds), [
    undefined,
    undefined,
    900,
    1800,
    undefined,
  ])
  equal(
    cookingIngredients(bundles.filter((r) => 'cook_recipe' in r)).map((r) =>
      r.text
    ),
    ['Stock', 'Flour', 'Carrots', 'Water', 'Salt'],
  )
})

// A snapshot taken as the file loads, of a source the case then edits.
let n = 0
const source = recipes()
const taken = snapshotSession(source, () => `id-${++n}`)
const before = JSON.stringify(taken.bundles)
test('Cooking snapshots survive source edits and source deletion without changing identities', () => {
  const { eid, bundles } = taken
  source[0].title = 'Edited'
  source[0].ingredients.push('Pepper')
  source[0].steps[0] = 'Different'
  source.splice(1, 1)
  equal(JSON.stringify(bundles), before)
  equal(bundles[0].entity.eid, eid)
  equal(new Set(bundles.map((r) => r.entity.eid)).size, bundles.length)
  const snapshots = bundles.filter((r) => 'cook_recipe' in r)
  equal(snapshots.map((r) => r.cook_recipe?.recipe), ['soup', 'bread'])
  equal(cookingIngredients([...snapshots].reverse())[0].title, 'Soup')
})

test('Cooking refuses an empty or repeated recipe selection', () => {
  throws(() => snapshotSession([]))
  throws(() => snapshotSession([recipes()[0], recipes()[0]]))
})

test('Cooking parses common units, compound durations, fractions, and range upper bounds', () => {
  for (
    const [text, expected] of [
      ['Wait 30 seconds.', 30],
      ['Rest 45 sec', 45],
      ['Microwave 90s', 90],
      ['Fry 2 mins', 120],
      ['Bake 1 hr and 20 min', 4800],
      ['Chill 1h 30m', 5400],
      ['Wait 1.5 hours', 5400],
      ['Cook for 5-10 min', 600],
      ['Cook 5 to 8 minutes', 480],
      ['Wait 10—20 secs', 20],
      ['Chill 1/2 hour', 1800],
      ['Rest 1 1/2 hrs', 5400],
      ['Rest 1½ hours', 5400],
      ['Rest ¼ hour', 900],
      ['Wait half a minute', 30],
      ['Rest an hour', 3600],
      ['Wait a second', 1],
      ['Bake 1-2 hours 30 minutes', 9000],
      ['Cook 10 minutes, then rest 5 minutes', 600],
      ['Bake at 180 C for 20 minutes', 1200],
      ['Sauté until golden', null],
      ['Season with 2 tbsp salt', null],
      ['180°C', null],
      ['', null],
      ['Cook 0 minutes', null],
      ['Rest -5 minutes', null],
    ] as const
  ) equal(parseDuration(text), expected, text)
})

test('Cooking manual durations reject blank, zero, fractional and non-finite seconds', () => {
  equal(validSeconds('65'), 65)
  for (const value of ['', ' ', '-1', '0', '1.2', 'Infinity', 'oops']) {
    throws(() => validSeconds(value))
  }
})

test('Cooking timer pause, resume and expiry derive from persisted clock values after reload', () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z')
  const base = { cook_step: { seconds: 90 } }
  const running = timerChange(base, 'start', now)
  equal(running, { due: '2026-10-15T12:01:30.000Z', remaining: null })
  const reloaded = JSON.parse(JSON.stringify({ ...base, timer: running }))
  equal(timerRemaining(reloaded.timer, now + 30200), 60)
  const paused = timerChange(reloaded, 'pause', now + 30200)
  equal(paused, { due: null, remaining: 60 })
  equal(timerRemaining(paused, now + 3600000), 60)
  const resumed = timerChange(
    { ...base, timer: paused },
    'start',
    now + 3600000,
  )
  equal(resumed, { due: '2026-10-15T13:01:00.000Z', remaining: null })
  equal(timerRemaining(resumed, now + 3660000), 0)
  equal(timerRemaining(resumed, now + 4000000), 0)
  equal(formatSeconds(3661), '1:01:01')
  equal(formatSeconds(60), '1:00')
  equal(formatSeconds(0), '0:00')
})

test('Cooking reset and manual overrides clear running mode and completed steps reject timers', () => {
  const step = {
    cook_step: { seconds: 10 },
    timer: { due: '2026-10-15T12:00:00Z' },
  }
  equal(timerChange(step, 'reset', 0, 45), { due: null, remaining: 45 })
  equal(timerChange(step, 'pause', Date.parse('2026-10-15T13:00:00Z')), {
    due: null,
    remaining: 0,
  })
  throws(() => timerChange(step, 'start', 0))
  throws(() =>
    timerChange({ cook_step: {}, timer: { remaining: 0 } }, 'start', 0)
  )
  throws(() => timerChange({ cook_step: {} }, 'start', 0))
  throws(() => timerChange({ ...step, completed: {} }, 'reset', 0))
  throws(() => timerRemaining({ due: 'not a date' }, 0))
})

// Prepare the small graph once; the behavior under test is alias admission,
// not vocabulary construction or host boot. No live app rows are written.
const { appVocab } = await import('../../workers/yak/vocab.ts')
const { graph } = await import('@yaks/graph')
const { ram } = await import('@yaks/ram')
const { edges } = await import('@yaks/edge')
const pickVocab = appVocab({
  $defs: {
    recipe: { properties: {} },
    cook_pick: { edge: true, properties: {} },
  },
})
const pickGraph = graph({
  vocab: pickVocab,
  storage: ram(pickVocab),
  plugins: [edges(pickVocab)],
})
const person = '47de583d-13de-49e1-bfc0-1e5601fc9193'
const recipe = '57de583d-13de-49e1-bfc0-1e5601fc9193'
await pickGraph.apply([{ entity: { eid: recipe }, recipe: {} }])
const choose = () =>
  pickGraph.apply([{
    entity: { eid: '$pick' },
    edge: { from: person, to: recipe },
    cook_pick: {},
  }])
const firstChoice = await choose()
const secondChoice = await choose()
await pickGraph.apply([{
  entity: { eid: firstChoice[0].entity.eid },
  $delete: true,
}])
const chosenAgain = await choose()

test('Cooking choice alias is idempotent and recreates the same relation without a seeded app person', async () => {
  equal(firstChoice[0].entity.eid, secondChoice[0].entity.eid)
  equal(chosenAgain[0].entity.eid, firstChoice[0].entity.eid)
  equal(chosenAgain[0].edge, { from: person, to: recipe })
  equal((await pickGraph.read(`.cook_pick&.edge.from=${person}`)).length, 1)
})

test('Cooking ownership reads public expanded person references and fails closed', () => {
  equal(refId({ eid: 'cook', name: 'Cook' }), 'cook')
  equal(
    ownsSession({ created: { by: { eid: 'cook', name: 'Cook' } } }, 'cook'),
    true,
  )
  equal(ownsSession({ created: { by: 'cook' } }, 'cook'), true)
  equal(ownsSession({ created: { by: { eid: 'other' } } }, 'cook'), false)
  equal(ownsSession({}, undefined), false)
})
