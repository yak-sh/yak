// The homes of the words an app borrows (T-32728). A word another app in the
// space declared first is used here and kept there, so a store whose app uses
// one answers a read naming it, a write carrying it and its pages' vocabulary
// across itself and each home, as one reach (@yaks/reach, reach.ts). Like a
// library's catalogue that lists the books of its branches beside its own:
// the reader asks at one desk, and the desk asks the branches.
//
// The store asks the directory which apps those homes are and vouches its
// caller to each, who reads there what their standing lets them: a home they
// may not read is left out, as if the app borrowed nothing from it.
import type { Eid } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { mode, reads } from '@yaks/member'
import { sandboxed } from '@yaks/platform/installs'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { type Reach, vocabAt } from './reach.ts'
import type { Who } from './session.ts'

/** Whether an app keeps to its own store: one scoped to it, or a sandboxed
 * install. Neither borrows across the space. */
export let local = (app: App) => app.scope == 'store' || sandboxed(app)

/** An app and the apps in its space homing the words it uses, as the
 * directory has them. */
export type Homes = { space: Space; app: App; homes: App[] }

/** The homes of the words `app` uses: none where it borrows none or keeps to
 * its own store, and null where the directory has no such app. */
export let homesOf = async (
  dir: Pick<Directory, 'appAt' | 'app'>,
  app: Eid,
  uses: Record<string, string>,
): Promise<Homes | null> => {
  let at = await dir.appAt(app)
  if (!at) return null
  let slugs = local(at.app) ? [] : [...new Set(Object.values(uses))]
  let homes = (await Promise.all(slugs.map((slug) => dir.app(at.space, slug))))
    .filter((one): one is App => !!one && !sandboxed(one))
  return { ...at, homes }
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
): Reach[] => [
  { space, app, who, ...self },
  ...homes.filter((one) => reads(mode(one.access), who.role))
    .map((home) => ({ space, app: home, who, headers: heed })),
]

/** The words a page of the reach's first store loads beside that store's
 * own documents: each home's declaration of the words this app uses from it,
 * and none of the other words a home speaks. */
export let borrowedDocs = async (
  env: Env,
  reach: Reach[],
  uses: Record<string, string>,
): Promise<VocabDoc[]> => {
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
