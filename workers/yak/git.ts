// Every app's deploy history AS A GIT REPOSITORY, contributed as data
// (plugin.ts): the two words the directory gains, the effect that mints a
// commit when a version is deployed, and the daily sweep that mints the ones
// that were missed. D-34943 is the shape; gitobj.ts does the work.
//
// The words are the DIRECTORY's, and only these two. `commit` is the fleet's
// own component (src/vocab/manifests/kernel.json), spelled here at the same
// meaning — `target` is what the commit is about, which for a yaks.app commit
// is the deploy it was minted from, so a history joins to the releases people
// already look at. `ref` is where a branch stands. Both live here rather than
// in the object store because access to an app is decided in the directory: a
// ref is the one part of a repository that belongs to one app.
//
// The OBJECTS do not live here at all. They are one global graph in a store of
// their own (door.ts `GIT_STORE`), because a git object is named by the digest
// of its own bytes and the same file deployed by two apps is one row.
//
// The sweep runs DAILY and not once. A backfill and a repair are the same act:
// a deploy from before any of this existed and a deploy whose effect could not
// reach the bucket leave exactly the same hole, and minting is repeatable — the
// author, the clock and the tree all come from the deploy — so a pass over a
// history that is already complete is reads and no writes.
import { CORE_URI, type PropSchema, type VocabDoc } from '@yaks/vocab'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import type { Plugin } from './plugin.ts'
import { reporting } from './wake.ts'

/** The component a deploy wears once it has been committed, and the row saying
 * where a branch stands. `target` dies with the deploy: a commit is ABOUT that
 * release, and a release nobody kept is a commit about nothing. */
let ref = (death: string): PropSchema => ({
  type: 'string',
  ref: 'entity',
  death,
})

export let gitDirectoryDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'git',
  $defs: {
    commit: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        // The entity's own eid is this value too — it is the object id, which
        // is what makes writing the same commit twice one row. The column is
        // spelled anyway because the fleet's `commit` spells it, and one word
        // means one thing in both graphs.
        sha: { type: 'string' },
        repo: { type: 'string' },
        message: { type: 'string' },
        target: ref('cascade'),
      },
    },
    // One row per app and branch name (gitobj.ts `refEid`), so moving a branch
    // patches the row that was there instead of leaving a second one behind.
    ref: {
      type: 'object',
      properties: {
        app: ref('cascade'),
        name: { type: 'string' },
        commit: ref('detach'),
      },
    },
  },
}

/** When the repair pass runs. Its own hour: it reads every deploy there is,
 * and the trash sweep is already walking every app at 4:20. */
export let DAILY = '50 4 * * *'

export let gitPlugin: Plugin = {
  name: 'yak/git',
  vocab: [gitDirectoryDoc],
  wakes: [{
    entity: { eid: 'yak-git' },
    wake: {
      every: DAILY,
      note: 'Commit yaks.app deploys nothing has committed',
    },
    sweep: { kind: 'git' },
  }],
  effects: [(on, at) => {
    // Deploys are the DIRECTORY's rows; an app's own store has none, so this
    // registration would never fire there.
    if (!at.meta) return
    on.created('deploy', async (e, tx, write) => {
      let { deployOf, minted } = await import('./gitobj.ts')
      // The whole entity, because a commit's clock and author are the
      // `created` stamp beside the component, not columns of it.
      let [row] = await tx.read(`.eid=${e.entity.eid}`)
      let deploy = row && deployOf(row)
      if (!deploy) return
      await minted(at.env, {
        read: async (line) => await tx.read(line),
        write: (bundles) => Promise.resolve(write(bundles)),
      }, deploy)
    })
  }],
  rules: [{
    name: 'git',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=git, #Env',
    run: async ({ Env: env }) => {
      if (!env) return
      let bound = env as unknown as Env
      return await reporting(bound, 'git', async () => {
        let { backfilled, held } = await import('./gitobj.ts')
        let made = await backfilled(bound, held(meta(bound)))
        if (made) console.log(`yak-git: ${made} deploys committed`)
      })
    },
  }],
}
