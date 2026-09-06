// AGENTS.md beside an app (standing.ts, T-34425), at its pure seams: the
// ceiling a write is refused against, the passage every agent is handed, the
// prompt names a person picks from, and the line a client is told when either
// moved. The doors themselves are mcp_test.ts's, inside workerd.
import { assert, assertEquals } from '@std/assert'
import type { App, Space } from './directory.ts'
import { CAP, type Entry, passage, prompted, tooLong } from './standing.ts'
import { stale } from './stream.ts'

let space = (slug: string) =>
  ({
    eid: `s-${slug}`,
    slug,
    title: slug,
    tier: null,
    plan: null,
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
  tools: [],
  ...over,
})

Deno.test('AGENTS.md is refused over the cap, with the number', () => {
  assertEquals(tooLong('AGENTS.md', CAP), '')
  assertEquals(tooLong('/AGENTS.md', CAP), '')
  // Every other file keeps the platform's own ceiling and no more.
  assertEquals(tooLong('index.html', CAP * 100), '')
  let no = tooLong('AGENTS.md', CAP + 1)
  assert(no.includes(String(CAP + 1)), no)
  assert(no.includes(String(CAP)), no)
  // The same file named the other way is the same file.
  assertEquals(tooLong('/AGENTS.md', CAP + 1), no)
})

Deno.test('the passage names every app, what it holds, and its rules', () => {
  assertEquals(passage([]), '')
  let said = passage([
    entry('recipes', { kinds: ['recipe'], tools: ['recipes__add'] }),
    entry('chores', { kinds: ['chore', 'week'] }),
  ])
  assert(said.includes('## kitchen/recipes'), said)
  assert(said.includes('https://kitchen.yaks.app/recipes/'), said)
  assert(said.includes('holds recipes'), said)
  assert(said.includes('Tools: recipes__add'), said)
  // An app with no words of its own still holds the platform's doc, and an
  // app with no tools says nothing about tools.
  assert(said.includes('holds chores, weeks'), said)
  assert(!said.includes('Tools: .'), said)
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

Deno.test("an app's rules ride under its heading, and only where written", () => {
  let said = passage([
    entry('recipes', { said: '# Recipes\n\nGrams, never cups.' }),
    entry('chores'),
  ])
  assert(said.includes('## kitchen/recipes\n'), said)
  assert(said.includes('Grams, never cups.'), said)
  assert(said.indexOf('Grams') < said.indexOf('## kitchen/chores'), said)
})

Deno.test('a prompt is named after the app, and never over something taken', () => {
  let rules = '# Recipes\n\nGrams, never cups.'
  let one = prompted([entry('recipes', { said: rules })], ['make', 'fix'])
  assertEquals(one.map((p) => p.name), ['recipes'])
  // The description is the file's own first line, with the heading marks off.
  assertEquals(one[0].description, 'Recipes')
  assertEquals(one[0].text, rules)
  // An app spelling a door's own prompt takes the seam a declared tool takes.
  assertEquals(
    prompted([entry('make', { said: rules })], ['make']).map((p) => p.name),
    ['make__agents'],
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
    'recipes__agents',
  ])
})

Deno.test('a session is told what moved, and never what did not', () => {
  let was = { version: 'a', names: ['about'], context: 'x' }
  // A release that moved no name and no app moves the version and says
  // nothing: there is nothing for the agent to do about it.
  assertEquals(stale(was, { ...was, version: 'b' }), undefined)
  assertEquals(stale(was, was), undefined)
  // A tool that appeared is the actionable news, even when the apps moved too.
  let more = { version: 'b', names: ['about', 'recipes__add'], context: 'y' }
  assert(stale(was, more)!.includes('recipes__add'), 'no tool named')
  // An app made, or an AGENTS.md edited: no name moved, and the agent is
  // still told, because it cached the instructions at connect.
  let edited = stale(was, { version: 'b', names: ['about'], context: 'y' })
  assert(edited!.includes('about'), edited)
  assert(edited!.includes('apps'), edited)
})
