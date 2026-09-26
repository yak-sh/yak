// The package as a graph plugin: the `ref` component, and the post-commit step
// that writes a Git commit when a release lands.
//
// It needs nothing from the application, because everything it would otherwise
// have to know about a release — what a release is called, where its manifest
// is, who authored it, what clock it happened on, which graphs and byte store
// hold its objects and branches — is supplied by the one callback passed to
// the factory ({@link Releases}). What is left is Git's: the objects, the
// branch, and the order they are written in.
//
// It hooks `effect` and only `effect`. A Git commit is written about data that
// is already durable — the release stands whether or not its history was
// written — so a failure here costs that release its Git commit and nothing
// else, which is exactly what the phase promises. It also means an application
// with its own post-commit hook registry (@yaks/effects) can register the same
// step there directly: {@link minting} is the step, and the plugin is that step
// plus the phase it is hooked on.

import type { Bundle, Plugin, Tx } from '@yaks/graph'
import { refDoc } from './comp.ts'
import { commitOnto, type Landing, type Repo } from './refs.ts'

/** A release, read in full: what to commit, and the repository to commit it
 * in. */
export type Released = Landing & { repo: Repo }

/** How an application's releases become Git commits. */
export type Releases = {
  /** the component that marks a bundle as a release — `deploy`, say */
  comp: string
  /**
   * Turns one committed bundle into a release to land, or returns `null` when
   * there is nothing to commit: a bundle that is not a release, one whose
   * manifest will not parse, or one this graph already holds a commit for.
   * Everything the application knows and this package cannot — the manifest,
   * the author, the clock, the stores — is read here.
   */
  of: (b: Bundle, tx: Tx) => Promise<Released | null> | Released | null
}

/**
 * The step itself: land every release in a committed transaction. An
 * application with its own post-commit hook registry calls this directly;
 * {@link commits} is the same step wrapped as a graph plugin.
 */
export let minting =
  (r: Releases) => async (bundles: Bundle[], tx: Tx): Promise<void> => {
    for (let b of bundles) {
      if (!b[r.comp]) continue
      let landing = await r.of(b, tx)
      if (landing) await commitOnto(landing.repo, landing)
    }
  }

/**
 * The Git plugin: the `ref` component, and an `effect` hook that writes a Git
 * commit for every release the transaction committed.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { commits, refDoc } from '@yaks/git'
 *
 * let deploy = { $defs: { deploy: { component: true, type: 'object' } } }
 * let vocab = loadVocab([refDoc, deploy])
 * // `of` says where each deploy lands, or null for one already committed.
 * let plugin = commits({ comp: 'deploy', of: async () => null })
 * let g = graph({ storage: ram(vocab), vocab, plugins: [plugin] })
 * ```
 *
 * The Git object components are not part of this plugin's vocabulary: an
 * application that keeps them in a store of their own loads {@link gitDoc}
 * there, and this plugin's graph is wherever the branches are.
 */
export let commits = (r: Releases): Plugin => {
  let mint = minting(r)
  return {
    name: '@yaks/git',
    vocab: [refDoc],
    hooks: {
      effect: async (bundles, tx) => {
        await mint(bundles, tx)
        return bundles
      },
    },
  }
}
