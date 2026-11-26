// The homes of the words an app borrows (T-32728). A word another app in the
// space declared first is used here and kept there, so a store whose app uses
// one answers a read naming it, a write carrying it and its pages' vocabulary
// across itself and each home, as one reach (@yaks/reach, reach.ts). Like a
// library's catalogue that lists the books of its branches beside its own:
// the reader asks at one desk, and the desk asks the branches.
//
// The store asks the directory which apps those homes are and vouches its
// caller to each, who reads there what their standing lets them: a home they
// may not read is left out, as if the app borrowed nothing from it, and a
// read naming one of its words is refused as borrowed from there (`unlent`).
import type { Eid } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { Denied, mode, reads } from '@yaks/member'
import { borrowed } from '@yaks/reach'
import { sandboxed } from '@yaks/platform/installs'
import type { App, Directory, Role, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Reach } from './reach.ts'
import type { Who } from './session.ts'

/** Whether an app keeps to its own store: one scoped to it, or a sandboxed
 * install. Neither borrows across the space. */
export let local = (app: App) => app.scope == 'store' || sandboxed(app)

type Home = { app: App; role: Role | null }

/** An app and the homes of its words, with the caller's standing at each. */
export type Homes = { space: Space; app: App; homes: Home[] }

/** The person whose directory standing can be used at a home. A visit and
 * an app acting as itself hold their standing in the borrowing store. */
export let personAtHome = (app: Eid, who: Who): string | null =>
  who.person == app || who.visit ? null : who.person

/** The homes of the words `app` uses: none where it borrows none or keeps to
 * its own store, and null where the directory has no such app. */
export let homesOf = async (
  dir: Pick<Directory, 'appAt' | 'page'>,
  app: Eid,
  uses: Record<string, string>,
  person: string | null,
): Promise<Homes | null> => {
  let at = await dir.appAt(app)
  if (!at) return null
  let slugs = local(at.app) ? [] : [...new Set(Object.values(uses))]
  let pages = await Promise.all(
    slugs.map((slug) => dir.page(at.space.slug, slug, person)),
  )
  let homes = pages.flatMap(({ app: home, role, grants }): Home[] =>
    home && home.space == at.space.eid && !home.trashed && !sandboxed(home)
      ? [{ app: home, role: role ?? grants?.get(home.eid) ?? null }]
      : []
  )
  return { ...at, homes }
}

// Whether the caller may read a home now: a private one is its members'.
let readable = ({ app, role }: Home) => reads(mode(app.access), role)

/** A read naming words the app borrows from a home its caller may not read
 * now. Alone, the app's store knows no such word, and would say so; this says
 * what happened instead. A `Denied`, so it answers as any read refused. */
export class Unlent extends Denied {
  constructor(who: Who, home: App, words: string[]) {
    super(who.person, home.eid, 'viewer', 'read', words[0])
    let one = words.length == 1
    this.message = `${words.map((w) => `.${w}`).join(', ')} ${
      one ? 'is' : 'are'
    } borrowed from ${home.slug}, which is private, so ${
      one ? 'it' : 'they'
    } can't be read here now`
  }
}

/** The refusal of `line` where it names words borrowed from a home the
 * caller may not read now, or null where it names none. */
export let unlent = (
  { homes }: Homes,
  who: Who,
  line: string,
  uses: Record<string, string>,
): Unlent | null => {
  let words = borrowed(line, uses)
  let home = homes.find((one) =>
    !readable(one) && words.some((w) => uses[w] == one.app.slug)
  )?.app
  return home
    ? new Unlent(who, home, words.filter((w) => uses[w] == home.slug))
    : null
}

/**
 * The stores a caller of the app's store is answered from: the store itself,
 * reached as `self` says, then each home the caller may read, asked with
 * `heed` beside.
 */
export let reachIn = (
  { space, app, homes }: Homes,
  who: Who,
  self: Pick<Reach, 'door' | 'headers'>,
  heed: Record<string, string> = {},
): Reach[] => {
  let caller = personAtHome(app.eid, who)
    ? who
    : { person: null, role: null, via: who.via }
  return [
    { space, app, who, ...self },
    ...homes.filter(readable).map(({ app: home, role }) => ({
      space,
      app: home,
      who: { ...caller, role },
      headers: heed,
    })),
  ]
}

/** The words a page of the reach's first store loads beside that store's
 * own documents: each home's declaration of the words this app uses from it,
 * and none of the other words a home speaks. */
export let borrowedDocs = async (
  env: Env,
  reach: Reach[],
  uses: Record<string, string>,
): Promise<VocabDoc[]> => {
  if (reach.length <= 1) return []
  let { vocabAt } = await import('./reach.ts')
  let docs = await Promise.all(
    reach.slice(1).map(async ({ space, app: home }) => {
      let doc = await vocabAt(env, space, home)
      let $defs = Object.fromEntries(
        Object.entries(doc.$defs ?? {}).filter(([name]) =>
          uses[name] == home.slug
        ),
      )
      return { title: home.slug, $defs } as VocabDoc
    }),
  )
  return docs.filter((doc) => Object.keys(doc.$defs!).length)
}
