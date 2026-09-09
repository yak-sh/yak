// The package as a graph plugin: the `ref` word, and the post-commit step that
// mints a commit when a RELEASE lands.
//
// It needs nothing from the application, because everything it would have to
// know about a release — what a release is called, where its manifest is, who
// authored it, what clock it happened on, which stores its objects and branches
// are in — is the one seam the factory takes ({@link Releases}). What is left
// is git's: the objects, the branch, and the order they are written in.
//
// It hooks `effect` and only `effect`. A commit is made ABOUT data that is
// already durable — the release stands whether or not its history was written —
// so a failure here costs that release its commit and nothing else, which is
// exactly what the phase promises. It also means the same step is registered
// straight onto a post-commit registry (@yaks/effects) by a host that has one:
// {@link minting} is the step, and the plugin is the phase it is mounted on.

import type { Bundle, Plugin, Tx } from '@yaks/graph'
import { refDoc } from './comp.ts'
import { commitOnto, type Landing, type Repo } from './refs.ts'

/** A release read whole: what to commit, and the repository to commit it in. */
export type Released = Landing & { repo: Repo }

/** How a host's releases become commits. */
export type Releases = {
  /** the component a release wears — `deploy`, say */
  comp: string
  /**
   * One committed bundle as a release to land, or `null` where there is
   * nothing to commit: a bundle that is not a release, one whose manifest will
   * not parse, or one this graph already holds a commit for. Everything the
   * host knows and this package cannot — the manifest, the author, the clock,
   * the stores — is read here.
   */
  of: (b: Bundle, tx: Tx) => Promise<Released | null> | Released | null
}

/**
 * The step itself: land every release in a committed batch. A host with its
 * own post-commit registry registers this directly; {@link commits} is the
 * same step as a graph plugin.
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
 * The git plugin: the `ref` word, and an `effect` hook that mints a commit for
 * every release the batch committed.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { commits, gitDoc } from '@yaks/git'
 *
 * let vocab = loadVocab([gitDoc, mine], keywords)
 * // let g = graph({ storage, vocab, plugins: [commits({ comp: 'deploy', of })] })
 * ```
 *
 * The OBJECTS' words are not among its vocabulary: a host keeping them in a
 * store of their own loads {@link gitDoc} there, and this plugin's graph is
 * wherever the branches are.
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
