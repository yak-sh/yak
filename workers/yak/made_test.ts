// What an app is made of, as a person who never saw its vocab.json reads it:
// each kind it keeps and what it keeps of one, each thing it can do, and the
// line that says when they can ask for those.
import { equal, test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { does, keeps, madeOf } from './made.ts'
import { appVocab } from './vocab.ts'

let whose = { app: 'Recipe box', operator: 'Otto' }
// What a panel says: each row's name and what describes it, or its one line
// when it holds none.
let read = (node: unknown) => {
  let { document } = parseHTML(
    `<div>${renderToString(h('div', null, node as never))}</div>`,
  )
  let rows = [...document.querySelectorAll('.Rows_Item')].map((r) =>
    [r.querySelector('.Rows_Name'), r.querySelector('.Rows_Meta')]
      .map((e) => e?.textContent ?? '').join(': ')
  )
  return rows.length ? rows : [document.querySelector('p')?.textContent]
}
let kept = (vocab: unknown, file?: string) =>
  read(keeps(madeOf(text(vocab), file), whose))
let done = (vocab: unknown, live = true) =>
  read(does(madeOf(text(vocab)), whose, live))
let text = (v: unknown) => typeof v == 'string' ? v : JSON.stringify(v)

let RECIPES = {
  $defs: {
    recipe: {
      properties: {
        serves: { type: 'number' },
        photoUrl: { type: 'string' },
        cook_time: { type: 'number', title: 'Minutes to cook' },
      },
    },
    meal_plan: { properties: { week: { type: 'string' } } },
    starred: { kind: false, properties: {} },
    plan_week: {
      tool: true,
      description: 'Picks seven dinners from the recipes. Each is new.',
    },
  },
}

test('the kinds of things an app keeps, each named as a person would, with what it keeps of one', () => {
  equal(kept(RECIPES), [
    'Recipe: Serves, photo url, and minutes to cook',
    'Meal plan: Week',
    'Starred: ',
  ])
  equal(
    kept('$defs:\n  shift:\n    properties:\n      who: {}\n', 'vocab.yml'),
    [
      'Shift: Who',
    ],
  )
  // A draft halfway written, or none yet, keeps nothing so far.
  for (let none of ['{"$defs": {', '', null]) {
    equal(kept(none), [
      'The kinds of things Recipe box keeps show here as Otto decides them.',
    ])
  }
})

test('what a kind keeps leaves out what the app keeps for itself', () => {
  let household = {
    $defs: {
      household: {
        title: 'Family',
        properties: {
          slug: { type: 'string', readOnly: true },
          street: { type: 'string' },
          street2: { type: 'string', title: 'Address line 2' },
          sample: { type: 'boolean', readOnly: true },
        },
      },
    },
  }
  equal(kept(household), ['Family: Street and address line 2'])
  // A deploy takes these words as written.
  appVocab(household)
})

test('what an app can do: its own commands, then adding and finding what it keeps', () => {
  let said = [
    'Plan week: Picks seven dinners from the recipes.',
    'Add and find what it keeps: A recipe or a meal plan',
  ]
  equal(done(RECIPES), said)
  equal(done({ ...RECIPES, tools: false }), said.slice(0, 1))
  // A kind whose add and find it declares itself is added and found by them.
  equal(
    done({
      $defs: {
        ...RECIPES.$defs,
        add_recipe: { tool: true, description: 'Adds one.' },
        find_recipe: { tool: true, description: 'Finds some.' },
      },
    }).at(-1),
    'Add and find what it keeps: A meal plan',
  )
  equal(done({}), ['What Recipe box can do shows here as Otto adds it.'])
})

test('what an app can do is asked for in the chat once it is live', () => {
  let note = (live: boolean) => {
    let { document } = parseHTML(
      renderToString(h('div', null, does(madeOf(text(RECIPES)), whose, live))),
    )
    return document.querySelector('.Talk_MadeNote')?.textContent
  }
  equal(
    note(true),
    'Ask for any of these in this chat, even with none of its pages open.',
  )
  equal(
    note(false),
    'Once it is live, you can ask for any of these in this chat, even with none of its pages open.',
  )
})
