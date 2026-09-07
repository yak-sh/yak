// The notes beside an app (standing.ts, T-34425), at their pure seams: the
// ceiling a write is refused against, the roster every agent is handed, the
// notes `about` hands over on top of it, the prompt names a person picks
// from, and the line a client is told when either moved. The doors themselves
// are mcp_test.ts's, inside workerd.
import { assert, assertEquals } from '@std/assert'
import type { App, Space } from './directory.ts'
import {
  CAP,
  type Entry,
  HAS_NOTES,
  passage,
  prompted,
  tooLong,
} from './standing.ts'
import { stale } from './stream.ts'

let space = (slug: string) =>
  ({
    eid: `s-${slug}`,
    slug,
    title: slug,
    tier: null,
    plan: null,
    stripe: null,
    meter: null,
    told: false,
  }) as Space

let app = (slug: string, title = ''): App =>
  ({
    eid: `a-${slug}`,
    slug,
    space: 's',
    version: 1,
    title,
    access: 'public',
    store: null,
    slugs: [slug],
  }) as App

let entry = (slug: string, over: Partial<Entry> = {}): Entry => ({
  space: space('kitchen'),
  app: app(slug, 'Recipes'),
  said: '',
  kinds: [],
  commands: [],
  ...over,
})

Deno.test('the notes are refused over the cap, with the number', () => {
  assertEquals(tooLong('NOTES.md', CAP), '')
  assertEquals(tooLong('/NOTES.md', CAP), '')
  // Every other file keeps the platform's own ceiling and no more.
  assertEquals(tooLong('index.html', CAP * 100), '')
  let no = tooLong('NOTES.md', CAP + 1)
  assert(no.includes(String(CAP + 1)), no)
  assert(no.includes(String(CAP)), no)
  // The same file named the other way is the same file.
  assertEquals(tooLong('/NOTES.md', CAP + 1), no)
  // And the name it was written under before T-34632 keeps its ceiling, since
  // an app that still carries one is still read (standing.ts NAMES).
  assert(tooLong('AGENTS.md', CAP + 1).includes('AGENTS.md'), 'old name')
  assertEquals(tooLong('AGENTS.md', CAP), '')
})

Deno.test('the roster names every app and what it holds', () => {
  assertEquals(passage([]), '')
  let said = passage([
    entry('recipes', { kinds: ['recipe'], commands: ['add_recipe'] }),
    entry('chores', { kinds: ['chore', 'week'] }),
  ])
  assert(said.includes('## kitchen/recipes'), said)
  assert(said.includes('https://kitchen.yaks.app/recipes/'), said)
  assert(said.includes('holds recipes'), said)
  assert(said.includes('Commands: add_recipe'), said)
  // An app with no words of its own still holds the platform's doc, and an
  // app with no commands says nothing about commands.
  assert(said.includes('holds chores, weeks'), said)
  assert(!said.includes('Commands: .'), said)
  assert(passage([entry('notes')]).includes('holds docs'), 'no fallback')
})

Deno.test('a plural is close enough to read as a sentence', () => {
  let holds = (kind: string) =>
    passage([entry('x', { kinds: [kind] })]).match(/holds ([a-z]+)/)![1]
  assertEquals(holds('recipe'), 'recipes')
  assertEquals(holds('dish'), 'dishes')
  assertEquals(holds('box'), 'boxes')
  assertEquals(holds('entry'), 'entries')
  assertEquals(holds('day'), 'days')
})

Deno.test("an app's notes ride under its heading, when asked for", () => {
  let apps = [
    entry('recipes', { said: '# Recipes\n\nGrams, never cups.' }),
    entry('chores'),
  ]
  let notes = passage(apps, true)
  assert(notes.includes('## kitchen/recipes\n'), notes)
  assert(notes.includes('Grams, never cups.'), notes)
  assert(notes.indexOf('Grams') < notes.indexOf('## kitchen/chores'), notes)
  // And NOT on the roster, which is the half that rides on the `initialize`
  // instructions (T-34632): the app is named there and its words are not, so
  // a host classifying the instructions reads ours and nobody else's.
  let roster = passage(apps)
  assert(roster.includes('## kitchen/recipes\n'), roster)
  assert(!roster.includes('Grams'), roster)
  assert(roster.includes(HAS_NOTES), roster)
  // An app with nothing written beside it says nothing either way.
  assert(!passage([entry('chores')]).includes(HAS_NOTES), 'nothing written')
})

Deno.test('a prompt is named after the app, and never over something taken', () => {
  let rules = '# Recipes\n\nGrams, never cups.'
  let one = prompted([entry('recipes', { said: rules })], ['make', 'fix'])
  assertEquals(one.map((p) => p.name), ['recipes'])
  // The listing is OUR words about the app, never the app's own: a prompt
  // list is classified the way a tool list is (T-34632). The file is the
  // prompt's text, which is fetched by name.
  assertEquals(one[0].title, 'Recipes: notes')
  assertEquals(one[0].description, 'The notes kept beside the Recipes app.')
  assert(!one[0].description.includes('Grams'), one[0].description)
  assertEquals(one[0].text, rules)
  // An app spelling a door's own prompt takes the `__` seam instead.
  assertEquals(
    prompted([entry('make', { said: rules })], ['make']).map((p) => p.name),
    ['make__notes'],
  )
  // And an app with nothing written beside it is offered no prompt at all.
  assertEquals(prompted([entry('recipes')], []), [])
  // Two apps in two spaces spelling one slug: the first answers, the second
  // takes the seam, and a third is left off rather than shadowing either.
  let three = [
    entry('recipes', { said: rules }),
    entry('recipes', { said: rules }),
    entry('recipes', { said: rules }),
  ]
  assertEquals(prompted(three, []).map((p) => p.name), [
    'recipes',
    'recipes__notes',
  ])
})

Deno.test('a session is told what moved, and never what did not', () => {
  let was = { version: 'a', names: ['about'] }
  // A release that moved no name moves the version and says nothing: there is
  // nothing for the agent to do about it. Which is every release now that the
  // roster is fixed (T-34541) except one that moved the platform's own tools.
  assertEquals(stale(was, { ...was, version: 'b' }), undefined)
  assertEquals(stale(was, was), undefined)
  // A tool that appeared is the news, and it names the tool.
  let more = { version: 'b', names: ['about', 'command'] }
  assert(stale(was, more)!.includes('command'), 'no tool named')
})
