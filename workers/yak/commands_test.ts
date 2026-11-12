// A named app answers its components, commands and notes through the published
// commands tool. The unfiltered listing keeps its command-only answer.
import { equal, ok, test } from '@yaks/testing'
import { parseTools } from '@yaks/tools/declared'
import type { VocabDoc } from '@yaks/vocab'
import { platform } from './directory-rows-probe.ts'
import { declared } from './directory-fixture.ts'
import { call, type Ctx } from './tools.ts'
import { commandLine } from './standing.ts'
import { staged } from './release.ts'
import { r2RawObjects } from './lib/objects.ts'

let { env, dir } = platform('commands-app-entry')
let person = crypto.randomUUID()
let who = { 'x-yak-person': person, 'x-yak-role': 'owner' }
let id = await dir.mint(person, 'kitchen', 'Kitchen', who)
let space = (await dir.at(id))!
let vocab = {
  $defs: {
    recipe: {
      component: true,
      description: 'A dish to cook',
      properties: {
        serves: { type: 'number', description: 'Number of people' },
        ingredients: { type: 'array', items: { type: 'string' } },
      },
    },
    meal: {
      component: true,
      description: 'A planned meal',
      properties: { day: { type: 'string' } },
    },
    find_recipe: {
      tool: true,
      description: 'Find recipes',
      input: { serves: { type: 'number', description: 'People to feed' } },
      required: ['serves'],
      query: '.recipe.serves=$serves',
    },
    internal: {
      tool: true,
      discoverable: false,
      description: 'An internal command',
      query: '.recipe',
    },
    owner_recipe: {
      tool: true,
      floor: 'owner',
      description: 'The owner recipe',
      query: '.recipe',
    },
  },
}
let make = async (slug: string, words: VocabDoc = vocab) => {
  let eid = crypto.randomUUID()
  let source = `kitchen/.releases/${eid}/${crypto.randomUUID()}`
  let staging = staged(r2RawObjects(env.BLOBS), {}, source)
  await staging.files.put(
    `${source}/NOTES.md`,
    new TextEncoder().encode('Weights in grams.'),
  )
  await staging.finish()
  await dir.apply({
    entities: [{
      entity: { eid },
      app: { space: id, slug, version: 1, access: 'private' },
      doc: { title: 'Recipe box' },
    }],
  }, who)
  await dir.stamp({ entities: [{ entity: { eid }, app: { source } }] })
  let app = (await dir.app(space, slug))!
  await declared(env, space, app, {
    vocab: {
      $defs: Object.fromEntries(
        Object.entries(words.$defs ?? {}).filter(([, schema]) =>
          schema.component
        ),
      ),
    },
    tools: parseTools(words, ['recipe', 'meal']),
  })
  return app
}
await make('recipes')
await make('empty', { $defs: { recipe: vocab.$defs.recipe } })
await make('quiet', {
  $defs: {
    shift: {
      component: true,
      properties: {
        who: { type: 'string', ref: 'entity' },
        swapped: { type: 'boolean' },
        hours: { type: 'number' },
      },
    },
  },
})
let ctx: Ctx = { env, dir, person }
let named = await call(ctx, 'commands', { app: 'recipes' })
let qualified = await call(ctx, 'commands', { app: 'kitchen/recipes' })
let withoutCommands = await call(ctx, 'commands', { app: 'empty' })
let unnamed = await call(ctx, 'commands', {})
let quiet = await call(ctx, 'commands', { app: 'quiet' })
let editor = crypto.randomUUID()
await dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: { space: id, person: editor, role: 'editor' },
  }],
}, who)
let limited = await call({ ...ctx, person: editor }, 'commands', {
  app: 'recipes',
})

test('naming an app returns its components, commands and notes in order', () => {
  equal(named.text, qualified.text)
  let sections = [
    '## kitchen/recipes',
    'https://kitchen.yaks.app/recipes/ — Recipe box',
    'recipe{serves?: number (Number of people), ingredients?: array of string} — A dish to cook',
    'meal{day?: string} — A planned meal',
    'find_recipe(serves: number (People to feed)) reads — Find recipes',
    '### NOTES.md\n\nWeights in grams.',
  ]
  let last = -1
  for (let section of sections) {
    let at = named.text!.indexOf(section)
    ok(at > last, `Missing or out of order: ${section}\n${named.text}`)
    last = at
  }
  ok(!named.text!.includes('internal'))
  ok(named.text!.includes('owner_recipe() reads'))
  ok(!limited.text!.includes('owner_recipe'))
  equal(named.value, qualified.value)
})

test('an app with no commands still answers its components and notes', () => {
  ok(withoutCommands.text!.includes('recipe{serves?: number'))
  ok(
    withoutCommands.text!.includes(
      'https://kitchen.yaks.app/empty/ — Recipe box',
    ),
  )
  ok(withoutCommands.text!.endsWith('Weights in grams.'))
  equal(withoutCommands.value, { commands: [] })
})

test('omitting the app preserves the command-only listing and structured answer', () => {
  equal(unnamed.value, named.value)
  equal(
    unnamed.text,
    '## kitchen/recipes\n' +
      (unnamed.value!.commands as Parameters<typeof commandLine>[0][])
        .map(commandLine).join('\n') +
      '\n\nRun one with command(name, args) — and ' +
      'app too where two apps spell the same command.',
  )
  ok(!unnamed.text!.includes('Weights in grams.'))
  ok(!unnamed.text!.includes('A dish to cook'))
})

test('what an app leaves undescribed is a warning wherever an agent looks', () => {
  let warned = [
    'no description yet: shift — say in vocab.json what each is and where ' +
    'a person sees it',
    'no description yet: shift.who, shift.swapped — say what each ' +
    'reference points at and what each flag means',
  ]
  ok(
    quiet.text!.endsWith(`### Warnings\n${warned.join('\n')}`),
    quiet.text,
  )
  // Written, there is nothing to warn of.
  ok(!named.text!.includes('### Warnings'), named.text)
})
