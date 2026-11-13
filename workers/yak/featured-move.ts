// What yaks.app features was said in two places that were not the platform's
// mark: `integration.featured`, a property of the integration's own row, and
// the list of apps the home pages show (demos.ts `DEMOS`), which gallery.ts
// read as the featured apps. Both are the platform's `featured{at, by, via}`
// now (@yaks/platform, T-160642), server-owned, on the thing featured. These
// move each into the mark, and the first sheds the old column. Only the
// directory holds integrations and apps.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { VocabDoc } from '@yaks/vocab'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

/** The retired property, as @yaks/connections last declared it, added back
 * to the integration it was a property of. */
export let integrationFeaturedSource: VocabDoc = {
  $defs: {
    integration: {
      component: true,
      extends: true,
      properties: {
        featured: {
          type: 'boolean',
          description: 'featured among the services the host catalog offers',
        },
      },
    },
  },
}

let marked = (at: string) => ({ featured: { at } })

/** An integration's patch: the mark in place of the property, guarded on the
 * property as it was read. */
export let integrationFeaturedMove = (
  row: Bundle,
  now = new Date().toISOString(),
): Bundle[] => {
  let was = (row.integration as Comp | undefined)?.featured
  if (was == null) return []
  return [{
    entity: { eid: row.entity.eid },
    ...was === true && !row.featured ? marked(now) : {},
    integration: { featured: null },
    $was: { integration: { featured: token(was) } },
  }]
}

export let integrationFeaturedRule: Rule = {
  mark: 'yak/store/integration-featured/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.integration.featured&?featured&*',
  source: integrationFeaturedSource,
  move: (row) => integrationFeaturedMove(row),
  drop: ['integration.featured'],
}

// The demo space and the apps its home pages showed when the mark replaced
// the list, frozen here: what was featured is history, and history does not
// move when the home pages do.
let DEMO = 'yourname'
let SHOWN = [
  'garden',
  'bookclub',
  'trip',
  'recipes',
  'guestbook',
  'chores',
  'housebook',
  'sound-lab',
  'vale',
  'menu',
  'directory',
]

/** A demo app's patch: the mark, where it is the demo space's and wears none
 * yet. */
export let demoFeaturedMove = (
  row: Bundle,
  read: (line: string) => Bundle[],
  now = new Date().toISOString(),
): Bundle[] => {
  let ref = (row.app as Comp | undefined)?.space as
    | string
    | { eid?: string }
    | undefined
  let space = typeof ref == 'object' ? ref?.eid : ref
  if (row.featured || !space) return []
  let [at] = read(`.entity.eid=${space}&.space`)
  return (at?.space as Comp | undefined)?.slug == DEMO
    ? [{ entity: { eid: row.entity.eid }, ...marked(now) }]
    : []
}

export let demoFeaturedRule: Rule = {
  mark: 'yak/store/demo-featured/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: `.app.slug=${SHOWN.join(',')}&!featured&*`,
  move: (row, read) => {
    if (!read) throw new Error("a demo app's space is read to feature it")
    return demoFeaturedMove(row, read)
  },
}
