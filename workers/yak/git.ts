// The platform's Git door and daily repair cadence. Its store words live in
// facets/git-vocab.ts; the deploy effect and schedule seed are composed through
// facets/git-effects.ts, and the sweep rule through facets/git-graph.ts.
import type { Plugin } from './plugin.ts'

/** When the repair pass runs. Its own hour: it reads every deploy there is,
 * and the trash sweep is already walking every app at 4:20. */
export let DAILY = '50 4 * * *'

export let gitPlugin: Plugin = {
  name: 'yak/git',
  // `<app>.git` on a space's hostname, ahead of the apps (git_door.ts,
  // T-34946). Loaded when it runs, for seo_door.ts's reason: the door reaches
  // directory.ts and apps.ts's neighbours, and plugins.ts is what those are
  // composed from — a load-time import here would close the circle.
  routes: [
    async (at) =>
      at.space == null
        ? null
        : await (await import('./git_door.ts')).answer(at),
  ],
}

export { gitDirectoryDoc } from './facets/git-vocab.ts'
