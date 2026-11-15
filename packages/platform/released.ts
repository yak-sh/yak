// A release directory opened on this machine as its app's store: the words
// its vocab.json declares, over the plugins yaks.app composes an app's store
// from (./config.ts `appConfig`), with the store's own `yak/*` plugins
// resolved to this package's facets (./facets.ts) and lent the store as a
// host that keeps no ledger beside it does (./lent.ts `bare`). Its commands
// run through @yaks/tools and its effects through @yaks/effects, as on any
// host @yaks/cli composes, and @yaks/api's doors answer for it.
//
// The release's own files answer at its addresses through the `yak/files`
// routes facet (./files-routes.ts), read from the directory as it stands, and
// the client its pages import at `./api/client.js` through `yak/client`
// (./client-routes.ts), which answers its doors in the page's wire, with the
// store's own beside them under `/api`, and
// its commands (./app-commands.ts `commandsOf`) are the store's own tools,
// called through its runner as any host's are.
// Of the effects the store's plugins declare it runs this package's own
// (./app-effects.ts); the rest are yaks.app's Cloudflare work, which owes no
// run here.
import { compose, facet, type Role, type Served } from '@yaks/cli/host'
import { type Config, configured } from '@yaks/host/config'
import { taking, wordsOf } from '@yaks/host/words'
import type { Load } from '@yaks/host'
import type { VocabDoc } from '@yaks/vocab'
import type { Loaded } from '@yaks/blob'
import * as disk from '@yaks/file/io'
import { mint } from '@yaks/graph/identity'
import { faulted, toolEid } from '@yaks/tools/result'
import { commands } from '@yaks/tools/declared'
import { read } from '@yaks/yaml'
import { commandsOf } from './app-commands.ts'
import { appConfig } from './config.ts'
import { resolved } from './facets.ts'
import { bare, lends } from './lent.ts'
import { appDocs, manifest, owned, owns, VOCABS } from './manifest.ts'

/** A release directory as its store reads it: its app's name, the
 * directory's own, its manifest as one document, and the manifest's value as
 * written (`source`, in `file`), which its commands are read from (./release.ts
 * `Release` is a release as its pages were built with it). */
export type Released = {
  name: string
  vocab: VocabDoc
  source: unknown
  file: string
}

/** Where a release's store lives and answers. */
export type Placing = {
  /** the SQLite file, or `:memory:` (default `.yak/store.db` in the
   * release directory) */
  db?: string
  port?: number
  hostname?: string
}

// The folder in a release directory its store is kept in.
let KEPT = '.yak'

/** The release at `dir`: a directory without a manifest declares no words. */
export let release = async (dir: string): Promise<Released> => {
  let name = disk.basename(disk.resolve(dir))
  for (let file of VOCABS) {
    let text = await disk.readTextFile(disk.join(dir, file)).catch((e) => {
      if (disk.isNotFound(e)) return undefined
      throw e
    })
    if (text !== undefined) {
      let vocab = manifest(text, file)
      return { name, vocab, source: text.trim() ? read(text, file) : {}, file }
    }
  }
  return { name, vocab: {}, source: {}, file: VOCABS[0] }
}

/** What a release's store composes: an app's store, its files and its
 * pages' client, and @yaks/api's doors to answer for it. */
export let releaseConfig = (at: Placing & { db: string }): Config => ({
  ...at,
  plugins: [
    ...appConfig.plugins!,
    'yak/files',
    'yak/client',
    // A page's client finds its store's doors beside itself, at `./api/`.
    { use: '@yaks/api', with: { under: '/api' } },
  ],
})

/** A file of the release at `dir`, by its path from the directory
 * (`/index.html`), versioned by when it last changed; null where there is
 * none, the path names a folder, or it is in `.yak/`, where this machine
 * keeps the release's store. */
export let reader =
  (dir: string) => async (path: string): Promise<Loaded | null> => {
    if (path.split('/')[1] == KEPT) return null
    let file = disk.join(dir, path)
    let info = await disk.stat(file).catch((e) => {
      if (disk.isNotFound(e) || disk.isNotADirectory(e)) return null
      throw e
    })
    if (!info || info.isDirectory) return null
    let bytes = new Uint8Array(await disk.readFile(file))
    return {
      bytes,
      version: `${info.mtime?.getTime().toString(36)}-${info.size}`,
    }
  }

/** The release at `dir` opened for `roles`. `load` is how a plugin's subpath
 * becomes a module (default @yaks/cli's), so a test can hand it modules. */
export let opened = async (
  dir: string,
  roles: readonly Role[],
  at: Placing = {},
  load: Load = facet,
): Promise<Served> => {
  let { name, vocab, source, file } = await release(dir)
  let db = at.db ?? disk.join(dir, KEPT, 'store.db')
  let config = releaseConfig({ ...at, db })
  let docs = appDocs(vocab)
  // Its permission and owner names resolve in the words the store composes,
  // or the release is refused in one sentence before its store opens, as a
  // deploy of it is.
  if (owns(vocab)) {
    let vocabs = await taking(configured(config), 'vocab', resolved(load))
    owned(wordsOf(vocabs, docs).vocab, file)
  }
  return compose(config, roles, resolved(load), {
    docs,
    // Checked against every component the store knows, as a deploy checks
    // them, once the store's words are composed.
    tools: (host) =>
      commands(commandsOf(source, vocab, name, host.graph.vocab.all, file)),
    options: lends({ ...bare(name, vocab), file: reader(dir) }),
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
