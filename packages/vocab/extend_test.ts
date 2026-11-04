import { equal, test } from '@yaks/testing'
import { extendsVocab, loadVocab, type PropSchema } from './mod.ts'

let note: PropSchema = {
  component: true,
  sync: 'none',
  properties: { title: { type: 'string' } },
}
let rule: PropSchema = { rule: true, match: '.note, +!seen' }
let was = loadVocab({ $defs: { note, rule } })
let next = (more: Record<string, PropSchema>) =>
  loadVocab({ $defs: { note, rule, ...more } })

test('vocabulary growth accepts new words and reordered object keys', () => {
  equal(
    extendsVocab(
      was,
      next({
        note: {
          properties: { title: { type: 'string' } },
          sync: 'none',
          component: true,
        },
        seen: { component: true },
      }),
    ),
    true,
  )
  equal(extendsVocab(was, was), true)
})

test('vocabulary growth preserves existing schema and declaration behavior', () => {
  let changes: PropSchema[] = [
    { ...note, sync: 'server' },
    { ...note, properties: { title: { type: 'number' } } },
    {
      ...note,
      properties: { ...note.properties, extra: { type: 'string' } },
    },
  ]
  for (let changed of changes) {
    equal(extendsVocab(was, next({ note: changed })), false)
  }
  equal(extendsVocab(was, loadVocab({ $defs: { rule } })), false)
  equal(extendsVocab(was, loadVocab({ $defs: { note } })), false)
  equal(
    extendsVocab(was, next({ rule: { ...rule, match: '.note, +!other' } })),
    false,
  )
})

test('status precedence is preserved even though schema object keys are unordered', () => {
  let defs = {
    first: { component: true },
    second: { component: true },
    note: { ...note, status: { first: 'a', second: 'b', default: 'open' } },
  }
  equal(
    extendsVocab(
      loadVocab({ $defs: defs }),
      loadVocab({
        $defs: {
          ...defs,
          note: {
            ...note,
            status: { second: 'b', first: 'a', default: 'open' },
          },
        },
      }),
    ),
    false,
  )
})

let annotated = {
  $defs: {
    note: {
      component: true,
      label: 'notes',
      properties: { title: { type: 'string', label: 'Title' } },
    },
  },
}
let plain = loadVocab(annotated)
test('new keyword registrations cannot reinterpret existing component or property metadata', () => {
  for (let level of ['comp', 'prop']) {
    equal(
      extendsVocab(
        plain,
        loadVocab(annotated, [{
          uri: 'urn:labels',
          [level]: ['label'],
        }]),
      ),
      false,
    )
  }
})

test('property order is immaterial unless it changes a derived identity', () => {
  let fields = (identity = false): PropSchema => ({
    component: true,
    properties: {
      first: { type: 'string', identity },
      last: { type: 'string', identity },
    },
  })
  for (let identity of [false, true]) {
    let note = fields(identity)
    let reverse = {
      ...note,
      properties: Object.fromEntries(
        Object.entries(note.properties!).reverse(),
      ),
    }
    equal(
      extendsVocab(
        loadVocab({ $defs: { note } }),
        loadVocab({ $defs: { note: reverse } }),
      ),
      !identity,
    )
  }
})
