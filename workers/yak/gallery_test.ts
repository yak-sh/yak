// The gallery's pure seams (T-34475): the two stamps read as one state, the
// letter that carries the decision, the ticket under its links, what words
// find, and the two places a listing is DRAWN — the page itself and the home
// page's showcase, which is a splice into a file that ships with its own
// examples in it.
//
// The whole act — publish, letter, approve, page, search, unpublish — is held
// in workerd in mcp_test.ts, where there is a directory to write and a letter
// to read off the log.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import type { App, Space } from './directory.ts'
import {
  card,
  found,
  install,
  letter,
  LIFE,
  listed,
  page,
  pictured,
  pilled,
  saying,
  showcase,
  type Shown,
  standing,
  ticket,
  ticketed,
} from './gallery.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'space-eid',
  slug: 'jeff',
  title: 'jeff',
  tier: 'free',
  plan: null,
  stripe: null,
  meter: null,
  told: false,
  trashed: null,
  ...over,
})

let app = (over: Partial<App> = {}): App => ({
  eid: 'app-eid',
  slug: 'recipes',
  space: 'space-eid',
  version: 1,
  title: 'Recipe box',
  access: 'public',
  store: null,
  slugs: ['jeff/recipes'],
  home: false,
  first: [],
  meter: null,
  published: {
    name: 'recipes',
    version: 1,
    at: '2026-09-01T00:00:00.000Z',
    about: 'Somewhere to keep recipes',
  },
  installed: null,
  gallery: null,
  seeded: null,
  trashed: null,
  ...over,
})

let asked = { askedAt: '2026-09-06T10:00:00.000Z', listedAt: '' }
let live = { ...asked, listedAt: '2026-09-06T12:00:00.000Z' }

Deno.test('the two stamps are the three states, said one way everywhere', () => {
  assertEquals(standing(app()), 'no')
  assertEquals(standing(app({ gallery: asked })), 'asked')
  assertEquals(standing(app({ gallery: live })), 'listed')
  assertStringIncludes(saying('no'), 'not in the gallery')
  assertStringIncludes(saying('asked'), 'waiting on us')
  assertStringIncludes(saying('listed'), 'https://yaks.app/gallery')
  assertEquals(pilled('no'), '')
  assertEquals(pilled('asked'), 'gallery: waiting')
  assertEquals(pilled('listed'), 'in the gallery')
})

// A listing is a published app, and nothing else may be one: the reader
// screens what the row cannot say for itself — a trashed app, and an app whose
// whole space is in the trash — so both leave the page the moment they are
// thrown away and are back, unasked, when they are restored.
Deno.test('the listing is the approved offers, minus what is in the trash', async () => {
  let at = (over: Partial<App>, s: Partial<Space> = {}) => ({
    space: space(s),
    app: app(over),
  })
  let dir = (offers: { space: Space; app: App }[]) => // deno-lint-ignore no-explicit-any
  ({ offers: () => Promise.resolve(offers) } as any)
  let trash = { at: '2026-09-06T00:00:00.000Z', by: 'p' }
  let all = await listed(dir([
    at({ eid: 'never', gallery: null }),
    at({ eid: 'waiting', gallery: asked }),
    at({ eid: 'shown', gallery: live }),
    at({ eid: 'binned', gallery: live, trashed: trash }),
    at({ eid: 'space-gone', gallery: live }, { trashed: trash }),
  ]))
  assertEquals(all.map((a) => a.eid), ['shown'])
  assertEquals(all[0].at, 'https://jeff.yaks.app/recipes/')
  assertEquals(install(all[0]), "app_install(name: 'recipes')")
})

let shown = (over: Partial<Shown> = {}): Shown => ({
  eid: 'app-eid',
  name: 'recipes',
  title: 'Recipe box',
  about: 'Somewhere to keep recipes',
  at: 'https://jeff.yaks.app/recipes/',
  since: '2026-09-06T12:00:00.000Z',
  space: space(),
  app: app(),
  ...over,
})

// Words against the title and the line its maker wrote, and nothing else. A
// title hit outranks a description hit, because a title is what the thing IS.
Deno.test('words find a listing by its name and its own description', () => {
  let all = [
    shown({ eid: 'a', name: 'recipes', title: 'Recipe box' }),
    shown({
      eid: 'b',
      name: 'potluck',
      title: 'Potluck sheet',
      about: 'Who is bringing which recipe',
    }),
    shown({
      eid: 'c',
      name: 'garden',
      title: 'Garden diary',
      about: 'What grew',
    }),
  ]
  assertEquals(found(all, 'recipe').map((a) => a.eid), ['a', 'b'])
  assertEquals(found(all, 'garden').map((a) => a.eid), ['c'])
  assertEquals(found(all, 'spreadsheet'), [])
  // No words at all is the whole gallery, newest first — the page in a tool.
  assertEquals(found(all, '').length, 3)
  assertEquals(found(all, 'recipe', 1).map((a) => a.eid), ['a'])
})

// The letter is the only door to a listing, so it carries the whole decision:
// what the app is, where it lives, who made it, and the two answers.
Deno.test('the letter names the app, its maker, and both answers', () => {
  let l = letter({
    title: 'Recipe box',
    about: 'Somewhere to keep recipes',
    url: 'https://jeff.yaks.app/recipes/',
    owner: 'Jeff',
    yes: 'https://yaks.app/gallery/review?t=yes',
    no: 'https://yaks.app/gallery/review?t=no',
  })
  assertEquals(l.to, 'hello@yaks.app')
  assertStringIncludes(l.subject, 'Recipe box')
  assertStringIncludes(l.body, 'Jeff asked to show an app')
  assertStringIncludes(l.body, 'https://jeff.yaks.app/recipes/')
  assertStringIncludes(l.body, 'Somewhere to keep recipes')
  assertStringIncludes(
    l.body,
    'Yes, list it:\nhttps://yaks.app/gallery/review?t=yes',
  )
  assertStringIncludes(
    l.body,
    'No, thank you:\nhttps://yaks.app/gallery/review?t=no',
  )
  assertStringIncludes(l.body, 'Nothing is listed until you say so')
})

// The ticket carries WHICH answer, signed, so a decline cannot be talked into
// a listing by editing an address — and it lapses on its own after a week.
slow(
  'a gallery ticket carries its answer for a week and no longer',
  async () => {
    let secret = 'gallery-secret'
    let yes = await ticket(app(), true, secret)
    let no = await ticket(app(), false, secret)
    assertEquals((await ticketed(yes, secret))?.list, true)
    assertEquals((await ticketed(no, secret))?.list, false)
    assertEquals((await ticketed(yes, secret))?.app, 'app-eid')
    assertEquals(await ticketed(yes, 'another-secret'), null)
    assertEquals(await ticketed(yes, secret, Date.now() + LIFE + 1), null)
    assertEquals(await ticketed('not-a-ticket', secret), null)
  },
)

// The app's own share card, out of the bytes we already hold — and an address
// relative to the app's page, which on our page would point at our files.
Deno.test("a listing takes its picture from the app's own og:image", () => {
  let at = 'https://jeff.yaks.app/recipes/'
  assertEquals(
    pictured('<meta property="og:image" content="card.png">', at),
    'https://jeff.yaks.app/recipes/card.png',
  )
  assertEquals(
    pictured(
      '<meta property="og:image" content="https://cdn.example/a.png">',
      at,
    ),
    'https://cdn.example/a.png',
  )
  assertEquals(pictured('<h1>no card here</h1>', at), '')
  // Somebody else's HTML, and only its head is ever read.
  assertEquals(
    pictured(
      `<title>x</title>${
        '<p>.</p>'.repeat(2000)
      }<meta property="og:image" content="late.png">`,
      at,
    ),
    '',
  )
})

// The page itself: every listing with its address and the line to run, and the
// head furniture an engine and a model read.
Deno.test('the gallery page carries the listings and its own metadata', async () => {
  let html = await page([
    shown({ shot: 'https://jeff.yaks.app/recipes/c.png' }),
  ])
    .text()
  assertStringIncludes(
    html,
    '<link rel="canonical" href="https://yaks.app/gallery">',
  )
  assertStringIncludes(
    html,
    '<title>The gallery — apps made with yaks.app</title>',
  )
  assertStringIncludes(
    html,
    '<meta name="description" content="Apps people built here',
  )
  assertStringIncludes(html, 'og:image')
  assertStringIncludes(html, '"@type":"CollectionPage"')
  assertStringIncludes(html, 'Recipe box')
  assertStringIncludes(html, 'https://jeff.yaks.app/recipes/c.png')
  assertStringIncludes(html, 'app_install(name: &#39;recipes&#39;)')
  // Nothing listed is a page that says so rather than an empty one.
  assertStringIncludes(await page([]).text(), 'Nothing is listed yet')
})

// The home page keeps its own examples in the file, and gives the space up to
// the newest three listings when there are any.
Deno.test('the showcase replaces the examples only when something is listed', () => {
  let file = `<ul class="Make_List"><li>A recipe box</li></ul><p>after</p>`
  assertEquals(showcase(file, []), file)
  let one = showcase(file, [shown({ title: 'Potluck sheet' })])
  assertEquals(one.includes('A recipe box'), false)
  assertStringIncludes(one, 'Potluck sheet')
  assertStringIncludes(one, '<p>after</p>')
  assert(one.endsWith('</ul><p>after</p>'))
  // Four listed, three shown: the section is a showcase, not the gallery.
  let three = showcase(
    file,
    ['a', 'b', 'c', 'd'].map((eid) => shown({ eid, title: `App ${eid}` })),
  )
  assertEquals(three.includes('App d'), false)
  assertStringIncludes(three, 'App c')
  // A file whose showcase has moved is left exactly as it is.
  assertEquals(
    showcase('<p>no list here</p>', [shown()]),
    '<p>no list here</p>',
  )
})

Deno.test('a card is one link to the app and one line to copy', () => {
  let html = card(shown())
  assertStringIncludes(html, 'href="https://jeff.yaks.app/recipes/"')
  assertStringIncludes(html, 'jeff.yaks.app/recipes/')
  // No picture of its own falls back to the platform's tile.
  assertStringIncludes(html, 'connector-512.png')
  // The install line is OUTSIDE the anchor: a link swallows the selection.
  assertEquals(html.indexOf('</a>') < html.indexOf('app_install'), true)
})
