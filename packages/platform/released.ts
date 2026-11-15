// A release directory opened on this machine as its app's store: the words
// its vocab.json declares, over the plugins yaks.app composes an app's store
// from (./config.ts `appConfig`), with the store's own `yak/*` plugins
// resolved to this package's facets (./facets.ts) and lent the store as a
// host that keeps no ledger beside it does (./lent.ts `bare`). Its commands
// run through @yaks/tools and its effects through @yaks/effects, as on any
// host @yaks/cli composes, and @yaks/api's doors answer for it.
//
// The Worker's own effects facets (yak/app, yak/trash, yak/models,
// yak/attribution) are yaks.app's Cloudflare work, so nothing here runs them;
// nor does anything serve the release's other files yet.
import { compose, facet, type Role, type Served } from '@yaks/cli/host'
import type { Config } from '@yaks/host/config'
import type { Load } from '@yaks/host'
import type { VocabDoc } from '@yaks/vocab'
import * as disk from '@yaks/file/io'
import { mint } from '@yaks/graph/identity'
import { faulted, toolEid } from '@yaks/tools/result'
import { appConfig } from './config.ts'
import { resolved } from './facets.ts'
import { bare, lends } from './lent.ts'
import { appDocs, manifest, VOCABS } from './manifest.ts'

/** A release directory as its store reads it: its app's name, the
 * directory's own, and its manifest as one document (./release.ts `Release`
 * is a release as its pages were built with it). */
export type Released = { name: string; vocab: VocabDoc }

/** Where a release's store lives and answers. */
export type Placing = {
  /** the SQLite file, or `:memory:` (default `.yak/store.db` in the
   * release directory) */
  db?: string
  port?: number
  hostname?: string
}

/** The release at `dir`: a directory without a manifest declares no words. */
export let release = async (dir: string): Promise<Released> => {
  let name = disk.basename(disk.resolve(dir))
  for (let file of VOCABS) {
    let text = await disk.readTextFile(disk.join(dir, file)).catch((e) => {
      if (disk.isNotFound(e)) return undefined
      throw e
    })
    if (text !== undefined) return { name, vocab: manifest(text, file) }
  }
  return { name, vocab: {} }
}

/** What a release's store composes: an app's store, and @yaks/api's doors
 * to answer for it. */
export let releaseConfig = (at: Placing & { db: string }): Config => ({
  ...at,
  plugins: [...appConfig.plugins!, '@yaks/api'],
})

/** The release at `dir` opened for `roles`. `load` is how a plugin's subpath
 * becomes a module (default @yaks/cli's), so a test can hand it modules. */
export let opened = async (
  dir: string,
  roles: readonly Role[],
  at: Placing = {},
  load: Load = facet,
): Promise<Served> => {
  let { name, vocab } = await release(dir)
  let db = at.db ?? disk.join(dir, '.yak', 'store.db')
  return compose(releaseConfig({ ...at, db }), roles, resolved(load), {
    docs: appDocs(vocab),
    options: lends(bare(name, vocab)),
  })
}

/** The release at `dir` served through @yaks/api's `serve`, until it stops or
 * `stopping` aborts: whether it answered without a fault. */
export let serve = async (
  dir: string,
  at: Placing = {},
  stopping?: AbortSignal,
): Promise<boolean> => {
  let host = await opened(dir, ['graph', 'effects', 'web'], at)
  let stop = () => host.stop()
  stopping?.addEventListener('abort', stop, { once: true })
  try {
    await host.runner.ensure(['serve'])
    let eid = mint()
    let landed = await host.runner.call({
      entity: { eid },
      call: { to: toolEid('serve'), args: {} },
    })
    return !faulted(landed, eid)
  } finally {
    stopping?.removeEventListener('abort', stop)
    await host.close()
  }
}
