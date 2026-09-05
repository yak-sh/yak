// Document validation: the storable profile, reserved names, and the
// additive-forever evolution rule. Each refusal names the fix.

import { assert, assertEquals } from '@std/assert'
import { grow, loadVocab, reserved, storable } from './mod.ts'
import type { VocabDoc } from './mod.ts'
import slice from './fleet/slice.schema.json' with { type: 'json' }

let doc = (defs: VocabDoc['$defs']): VocabDoc => ({ $defs: defs })

Deno.test('the slice is storable', () => {
  assertEquals(storable(slice), [])
})

Deno.test('storable refuses what a table cannot lower', () => {
  let errs = storable(doc({
    'Bad Name': { type: 'object' },
    recipe: {
      type: 'object',
      properties: {
        steps: { type: 'array' },
        author: { type: 'object' },
        nested: { properties: { deep: { type: 'string' } } },
        linked: { $ref: '#/$defs/recipe' },
        eid: { type: 'string' },
        aim: { type: 'string', ref: 'entity' },
        dead: { type: 'string', ref: 'entity', death: 'explode' },
      },
    },
  }))
  let said = errs.join('\n')
  assert(said.includes('"Bad Name" is not a component name'))
  assert(said.includes('recipe.steps is array'))
  assert(said.includes('recipe.author is object'))
  assert(said.includes('recipe.nested is nested'))
  assert(said.includes('recipe.linked uses $ref'))
  assert(said.includes('recipe."eid" is not a column name'))
  assert(said.includes('recipe.aim is a reference without a death word'))
  assert(said.includes('recipe.dead is a reference without a death word'))
})

Deno.test('storable refuses an index over a column that is not there', () => {
  let errs = storable(doc({
    recipe: {
      type: 'object',
      unique: [['serves', 'oven']],
      index: [['serves']],
      properties: { serves: { type: 'number' } },
    },
  }))
  assertEquals(errs, ['recipe indexes oven, which is no column of recipe'])
})

Deno.test('reserved names refuse against a base vocabulary', () => {
  let base = loadVocab(slice)
  let app = doc({
    doc: { type: 'object' },
    recipe: { type: 'object', properties: { serves: { type: 'number' } } },
  })
  assertEquals(reserved(app, base.all), [
    "'doc' is a word the platform already owns — pick another name",
  ])
  assertEquals(reserved(doc({ recipe: { type: 'object' } }), base.all), [])
})

Deno.test('evolution is additive forever', () => {
  let was = loadVocab(doc({
    recipe: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        serves: { type: 'number' },
        state: { enum: ['draft'] },
      },
    },
  }))
  // adding a column and widening an enum are additive
  let grown = loadVocab(doc({
    recipe: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        serves: { type: 'number' },
        state: { enum: ['draft', 'published'] },
        mins: { type: 'number' },
      },
    },
  }))
  assertEquals(grow(was, grown), { added: ['recipe.mins'], errors: [] })
  // retyping refuses
  let retyped = loadVocab(doc({
    recipe: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        serves: { type: 'string' },
        state: { enum: ['draft'] },
      },
    },
  }))
  assert(grow(was, retyped).errors[0].includes('recipe.serves was'))
  // dropping refuses — the rows are still there
  let dropped = loadVocab(doc({
    recipe: { type: 'object', properties: { title: { type: 'string' } } },
  }))
  let errs = grow(was, dropped).errors.join('\n')
  assert(errs.includes('recipe.serves was dropped'))
  assert(errs.includes('recipe.state was dropped'))
})
