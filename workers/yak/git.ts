// Every app's deploy history AS A GIT REPOSITORY, contributed as data
// (plugin.ts): the two words the directory gains, the effect that mints a
// commit when a version is deployed, and the daily sweep that mints the ones
// that were missed. D-34943 is the shape; @yaks/git does the work, and
// gitobj.ts is the adapter that tells it what a yaks.app deploy is.
//
// The two words the directory gains are `commit` and `ref`, and only one of
// them is declared here. `commit` is the fleet's own component
// (src/vocab/manifests/kernel.json), spelled here at the same meaning —
// `target` is what the commit is about, which for a yaks.app commit is the
// deploy it was minted from, so a history joins to the releases people already
// look at. `ref` is @yaks/git's own word (`refDoc`), loaded here rather than in
// the object store because access to an app is decided in the directory: a ref
// is the one part of a repository that belongs to one app.
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
import { minting, refDoc } from '@yaks/git'
import type { Bundle } from '@yaks/graph'
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import type { Plugin } from './plugin.ts'
import { reporting } from './wake.ts'

/** The component a deploy wears once it has been committed. `target` dies with
 * the deploy: a commit is ABOUT that release, and a release nobody kept is a
 * commit about nothing. */
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
        target: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
  },
}

/** When the repair pass runs. Its own hour: it reads every deploy there is,
 * and the trash sweep is already walking every app at 4:20. */
export let DAILY = '50 4 * * *'

export let gitPlugin: Plugin = {
  name: 'yak/git',
  vocab: [gitDirectoryDoc, refDoc],
  // `<app>.git` on a space's hostname, ahead of the apps (git_door.ts,
  // T-34946). Loaded when it RUNS, for seo_door.ts's reason: the door reaches
  // directory.ts and apps.ts's neighbours, and plugins.ts is what those are
  // composed from — a load-time import here would close the circle.
  routes: [
    async (at) =>
      at.space == null
        ? null
        : await (await import('./git_door.ts')).answer(at),
  ],
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
    // @yaks/git's own step (`minting`), mounted on this Worker's post-commit
    // registry rather than on the graph's `effect` phase, for the one thing
    // the registry has that the phase does not: a write door that goes back
    // through `apply()`, so the commit is journaled and cast like any other.
    on.created('deploy', async (e, tx, write) => {
      let { releases } = await import('./gitobj.ts')
      let dir = {
        read: async (line: string) => await tx.read(line),
        write: (bundles: Bundle[]) => Promise.resolve(write(bundles)),
      }
      // The event as the bundle the step reads: what a registry says happened
      // to one component, said the way a batch says it.
      await minting(releases(at.env, dir))(
        [{ entity: e.entity, [e.name]: e.comp ?? {} }],
        tx,
      )
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
