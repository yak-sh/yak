import type { Env } from './env.ts'
import { type Declaration, keepDeclaration } from './declaration.ts'
import { type App, type Directory, releaseOf, type Space } from './directory.ts'

/** What a deploy keeps beside the release it selects, for a fixture that
 * stamps an app's version instead of deploying: by default no words and no
 * commands. */
export let declared = (
  env: Env,
  space: Space,
  app: App,
  value: Declaration = { vocab: {}, tools: {} },
) => keepDeclaration(env, space, app, releaseOf(app), value)

/** A space on the free plan, as the directory reads one, for a test to vary. */
export let space = (over: Partial<Space> = {}): Space => ({
  eid: 'space-eid',
  slug: 'jeff',
  store: 'jeff',
  title: 'jeff',
  operator: 'Wren',
  tier: 'free',
  plan: null,
  seller: null,
  fee: 0,
  budget: null,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
  ...over,
})

/** A free space this person owns, written the way directory.ts `mint` writes
 * one: what a space made before one person was held to one free space
 * (meter.ts `SPACES`) is. Answers its eid. probe.ts `owned` is the same for
 * a kernel. */
export let owned = (
  ctx: { dir: Directory; person: string },
  slug: string,
  title = slug,
) =>
  ctx.dir.mint(ctx.person, slug, title, {
    'x-yak-person': ctx.person,
    'x-yak-role': 'owner',
  })

/** A published public app in {@link space}, for a test to vary. */
export let app = (over: Partial<App> = {}): App => ({
  policy: 0,
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
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
  ...over,
})

/** The space {@link Directory.own} answers for a person this test makes now:
 * every way in writes the person before asking (signin.ts `personOf`), and
 * `own` takes a person with no row for an erased one. */
export let ownedBy = async (dir: Directory, person: string, want?: string) => {
  await dir.stamp({ entities: [{ entity: { eid: person }, person: {} }] })
  return dir.own(person, want)
}
