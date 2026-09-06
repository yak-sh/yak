// The two tools a kind is worth: what they are called, what they ask for, what
// they say, and the two ways an app declines them. The workerd half — the same
// manifest through app_deploy and a call at the MCP door — is in mcp_test.ts.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { withKinds } from './kinds.ts'
import { appDoc } from './vocab.ts'
import { filled, schemaOf } from '../../src/store/tools.ts'

let box = {
  $defs: {
    recipe: {
      type: 'object',
      kind: true,
      description: 'a dish somebody cooks, with what it takes and how long',
      properties: { serves: { type: 'number' }, cuisine: { type: 'string' } },
    },
    // Not a kind: a mark a recipe wears, which is nobody's thing to add.
    starred: { type: 'object', properties: { at: { type: 'string' } } },
  },
}

let tools = (doc: unknown = box, at = 'jeff/recipes') =>
  withKinds({}, appDoc(doc), at)

Deno.test('every kind is two tools, and nothing else is', () => {
  assertEquals(Object.keys(tools()), ['add_recipe', 'find_recipe'])
})

Deno.test('the sentence says the app and what the vocabulary means', () => {
  assertEquals(
    tools().add_recipe.description,
    'Add a recipe to jeff/recipes: a dish somebody cooks, with what it takes ' +
      'and how long',
  )
  assertStringIncludes(
    tools().find_recipe.description,
    'Find recipes in jeff/recipes: a dish somebody cooks, with what it takes ' +
      'and how long. Words match the title and body',
  )
  // A manifest in the short form claims no meaning, so the sentence stops.
  assertEquals(
    tools({ dish: { serves: 'number' } }).add_dish.description,
    'Add a dish to jeff/recipes',
  )
  assertStringIncludes(
    tools({ story: {} }).find_story.description,
    'Find stories in jeff/recipes. Words match',
  )
})

Deno.test('add takes a title and the kind’s own columns', () => {
  let add = tools().add_recipe
  assertEquals(Object.keys(schemaOf(add).properties), [
    'title',
    'body',
    'alias',
    'serves',
    'cuisine',
  ])
  assertEquals(schemaOf(add).properties.serves, { type: 'number' })
  // Only the title: the rest of a row is filled in when there is something to
  // fill it with.
  assertEquals(schemaOf(add).required, ['title'])
  assertEquals(
    filled(add, { title: 'Lemon cake', serves: '8', alias: 'lemon-cake' }),
    {
      apply: {
        entity: { eid: '$recipe' },
        doc: { title: 'Lemon cake' },
        alias: { name: 'lemon-cake' },
        recipe: { serves: 8 },
      },
    },
  )
  // Nothing but the title: the empty words go with their holes, and no
  // nameless alias is written.
  assertEquals(filled(add, { title: 'Toast' }), {
    apply: {
      entity: { eid: '$recipe' },
      doc: { title: 'Toast' },
      recipe: {},
    },
  })
})

Deno.test('find is a filter line, one clause per argument given', () => {
  let find = tools().find_recipe
  assertEquals(schemaOf(find).required, [])
  assertEquals(
    filled(find, { words: 'lemon', serves: 8, limit: 5 }).query,
    '.recipe!&.doc?&lemon&.recipe.serves=8&limit=5',
  )
  // A clause whose argument nobody sent drops out, and the rest still reads.
  assertEquals(
    filled(find, { cuisine: 'thai & lao' }).query,
    '.recipe!&.doc?&.recipe.cuisine=thai%20%26%20lao',
  )
  // Nothing at all is every recipe there is.
  assertEquals(filled(find, {}).query, '.recipe!&.doc?')
})

Deno.test('an app declines them, or spells one itself', () => {
  // The manifest says so, in either spelling.
  assertEquals(withKinds({}, appDoc({ ...box, tools: false }), 'a/b'), {})
  assertEquals(withKinds({}, appDoc({ dish: {}, tools: false }), 'a/b'), {})
  // Or a tools.json spells the name, and that one is whole: the app's own
  // template, its own sentence, its own arguments.
  let own = {
    add_recipe: {
      description: 'Add a recipe the way this app means it',
      input: { title: 'text' as const },
      apply: { entity: { eid: '$r' }, doc: { title: '{{title}}' } },
    },
  }
  let both = withKinds(own, appDoc(box), 'jeff/recipes')
  assertEquals(Object.keys(both), ['add_recipe', 'find_recipe'])
  assertEquals(both.add_recipe, own.add_recipe)
})
