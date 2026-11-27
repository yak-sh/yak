// Reading in a namespace: what a bare label, a full label and an identity
// mean to each reader, and what each reader writes a word back as.
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { Ambiguous, loadVocab, Unknown } from './mod.ts'
import type { Namespace, PropSchema, VocabDoc } from './types.ts'

let [MODEL, TRIP, SHOP, COST, TRIP_COST, SHOP_COST, DOLLARS, EUROS, PRICE] =
  Array.from({ length: 9 }, () => crypto.randomUUID())
let urn = (id: string) => `urn:uuid:${id}`
let comp = (id: string, prop: string, pid: string): PropSchema => ({
  $id: urn(id),
  component: true,
  type: 'object',
  properties: { [prop]: { $id: urn(pid), type: 'number' } },
})
let doc = (
  id: string,
  label: string,
  $defs: Record<string, PropSchema>,
): VocabDoc => ({ $id: urn(id), label, $defs })
let model = doc(MODEL, '@yaks/model', { cost: comp(COST, 'dollars', DOLLARS) })
let trip = doc(TRIP, 'yourname/trip', {
  cost: comp(TRIP_COST, 'euros', EUROS),
})
let shop = doc(SHOP, '@yaks/shop', { cost: comp(SHOP_COST, 'price', PRICE) })

let IN_MODEL = { label: '@yaks/model' }, IN_TRIP = { id: TRIP }
let LEND = { label: 'yourname/lend' }
let AMBIGUOUS =
  '.cost is ambiguous (@yaks/model:cost, yourname/trip:cost) — use ' +
  '.yourname/trip:cost'

// What `cost.<prop>` aims at, read in each namespace: the component's name as
// that reader writes it, or the refusal.
let aims = (
  docs: VocabDoc[],
  rows: [Namespace | undefined, string, string | RegExp][],
  former?: Record<string, string[]>,
  uses?: Namespace[],
) => {
  let v = loadVocab(docs)
  for (let [ns, path, want] of rows) {
    let r = v.in(ns, { former, uses })
    if (typeof want == 'string') {
      let [c, p] = want.split('.')
      equal(r.aim(path), [{ comp: c, prop: p }], `${ns?.label}: ${path}`)
    } else {
      let e = assertThrows(() => r.aim(path), Unknown)
      equal(want.test(e.message), true, `${path}: ${e.message}`)
    }
  }
}

test('a bare label shared by two words is refused naming their full labels', () => {
  let v = loadVocab([model, trip])
  let e = assertThrows(() => v.aim('cost.euros'), Ambiguous)
  equal(e.message, AMBIGUOUS)
  equal(e.candidates, ['@yaks/model:cost', 'yourname/trip:cost'])
  equal(e instanceof Unknown, true)
  assertThrows(() => v.aim('cost', true), Ambiguous)
  assertThrows(() => v.held('cost'), Ambiguous, AMBIGUOUS)
  // A lookup finds no one component, and refuses nothing.
  equal(v.comp('cost'), undefined)
})

test('a full label and an identity mean their word to every reader', () => {
  let v = loadVocab([model, trip])
  // Each reader, and the names it writes trip's cost and the model's by.
  let rows: [Namespace | undefined, string, string][] = [
    [undefined, 'yourname/trip:cost', '@yaks/model:cost'],
    [IN_MODEL, 'yourname/trip:cost', 'cost'],
    [IN_TRIP, 'cost', '@yaks/model:cost'],
    [LEND, 'yourname/trip:cost', '@yaks/model:cost'],
  ]
  for (let [ns, tripCost, modelCost] of rows) {
    let r = v.in(ns)
    for (let path of ['yourname/trip:cost.euros', `${TRIP_COST}.${EUROS}`]) {
      equal(r.aim(path), [{ comp: tripCost, prop: 'euros' }])
    }
    equal(r.held('@yaks/model:cost'), modelCost)
    equal(r.held(COST), modelCost)
    equal(r.prop(COST, DOLLARS)?.prop, 'dollars')
  }
  equal(v.held(TRIP_COST), 'yourname/trip:cost')
  equal(v.comp('@yaks/shop:cost'), undefined)
})

test('a bare label is the reader’s own word, then one it uses, then the one other', () => {
  aims([model, trip], [
    [undefined, 'cost.euros', /ambiguous/],
    [IN_MODEL, 'cost.dollars', 'cost.dollars'],
    [IN_MODEL, 'yourname/trip:cost.euros', 'yourname/trip:cost.euros'],
    [IN_TRIP, 'cost.euros', 'cost.euros'],
    [IN_TRIP, '@yaks/model:cost.dollars', '@yaks/model:cost.dollars'],
    [IN_TRIP, 'cost.dollars', /unknown property: cost.dollars/],
    [LEND, 'cost', /ambiguous/],
  ])
  // An app reads a word of its space it uses before the base's.
  aims([model, trip], [[LEND, 'cost.euros', 'cost.euros']], undefined, [
    { label: 'yourname/trip' },
  ])
  // Two base words of one label: a package reads its own bare, and one with
  // none of its own qualifies.
  aims([model, shop], [
    [{ label: '@yaks/shop' }, 'cost.price', 'cost.price'],
    [IN_MODEL, 'cost.dollars', 'cost.dollars'],
    [
      LEND,
      'cost',
      /\(@yaks\/model:cost, @yaks\/shop:cost\) — use .@yaks\/model/,
    ],
  ])
  // A label one word holds means it to every reader.
  aims([model], [[undefined, 'cost.dollars', 'cost.dollars']])
  aims([model], [[IN_TRIP, 'cost.dollars', 'cost.dollars']])
})

test('a reader writes each word by the label it reads back as', () => {
  let v = loadVocab([model, trip])
  let t = v.in(IN_TRIP)
  equal(t.all, ['@yaks/model:cost', 'cost'])
  equal(t.comp('cost')?.name, 'cost')
  equal(t.comp('cost')?.namespace?.label, 'yourname/trip')
  equal(t.word(COST), { comp: '@yaks/model:cost' })
  equal(t.word(EUROS), { comp: 'cost', prop: 'euros' })
  equal(t.prop('cost', 'euros')?.comp, 'cost')
  equal(t.props('@yaks/model:cost'), ['dollars'])
  equal(t.check('cost', { euros: 'x' }), [
    'yourname/trip:cost.euros is a number',
  ])
  equal(v.in(IN_MODEL).all, ['cost', 'yourname/trip:cost'])
  equal(v.all, ['@yaks/model:cost', 'yourname/trip:cost'])
})

test('a reader that reads every name alike reads the vocabulary itself', () => {
  let v = loadVocab([model, trip])
  equal(v.in() === v, true)
  equal(v.in(IN_TRIP) === v.in(IN_TRIP), true)
  let one = loadVocab(model)
  equal(one.in(IN_MODEL) === one, true)
  equal(one.in(LEND, { uses: [IN_TRIP] }) === one, true)
})

// trip renamed its cost to spend, and its euros to amount, keeping both
// identities.
let renamed = doc(TRIP, 'yourname/trip', {
  spend: {
    ...comp(TRIP_COST, 'amount', EUROS),
  },
})
let former = { [TRIP_COST]: ['cost'], [EUROS]: ['euros'] }

test('a former label keeps meaning its word in its namespace', () => {
  aims([model, renamed], [
    [IN_TRIP, 'cost.euros', 'spend.amount'],
    [IN_TRIP, 'spend.amount', 'spend.amount'],
    [IN_TRIP, 'yourname/trip:cost.amount', 'spend.amount'],
    [IN_TRIP, '@yaks/model:cost.dollars', '@yaks/model:cost.dollars'],
    // Elsewhere the label is the one word that holds it now.
    [IN_MODEL, 'cost.dollars', 'cost.dollars'],
    [undefined, 'cost.dollars', 'cost.dollars'],
    [undefined, 'yourname/trip:cost.amount', 'spend.amount'],
  ], former)
  // Read with no former labels, trip's cost is the base's.
  aims([model, renamed], [[IN_TRIP, 'cost.dollars', 'cost.dollars']])
  // Until another of its words takes the label.
  let taken = doc(TRIP, 'yourname/trip', {
    ...renamed.$defs,
    cost: comp(crypto.randomUUID(), 'tip', crypto.randomUUID()),
  })
  aims([model, taken], [
    [IN_TRIP, 'cost.tip', 'cost.tip'],
    [IN_TRIP, 'spend.euros', 'spend.amount'],
  ], former)
})
