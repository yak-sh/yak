// Which toolkit a release's compile was made of, and whether the platform
// serving it still has that toolkit (T-139858).
//
// A compile reaches the toolkit packages its package.json names and theirs,
// and its pages import them as shared modules named by their bytes, so a
// release keeps the toolkit it was compiled with for as long as it serves.
// A fix in a shared package reached an app only when it next deployed. Now a
// compile records the source digest of each toolkit package it reached
// (`RECORD`, esbuild.ts), and the platform's own digests ride beside its
// catalog (`_compiler/toolkit.json`, bin/compiler-packages.ts). A page served
// from a release whose record differs from them, or that was compiled before
// compiles kept one, has that release made again as itself, compiled by the
// toolkit serving it now (tools.ts `recompileRelease`, apps.ts `refresh`):
// the next page is the fixed one, and nobody recompiles anything by hand.
import { toolkitOf, type Toolkits, toolkits } from '@yaks/esbuild'
import type { Env } from './env.ts'
import { url } from '@yaks/platform/host'
import { filesIn } from './release.ts'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { BUILT } from './versions.ts'

/** Where a release keeps the digests of the toolkit it was compiled with. */
export let RECORD = `${BUILT}.toolkit.json`
let COMPILED = `${BUILT}.compile.json`

// Per assets binding, the isolate's one in a deployment, as esbuild.ts keeps
// its catalog. A kernel whose assets hold no toolkit.json (a probe's) reads
// the digests out of its catalog.
let kits = new WeakMap<Env['ASSETS'], Promise<Toolkits>>()
let asset = async (env: Pick<Env, 'ASSETS'> & Partial<Env>, path: string) => {
  let r = await env.ASSETS.fetch(new Request(url(env, path)))
  if (r.ok) return await r.json()
  await r.body?.cancel()
  return null
}

/** The toolkit this platform compiles with. */
export let current = (
  env: Pick<Env, 'ASSETS'> & Partial<Env>,
): Promise<Toolkits> => {
  let kit = kits.get(env.ASSETS)
  if (kit) return kit
  kit = (async () => {
    let made = await asset(env, '/_compiler/toolkit.json')
    if (made) return made as Toolkits
    let catalog = await asset(env, '/_compiler/packages.json')
    if (catalog) return toolkits(catalog as Parameters<typeof toolkits>[0])
    throw new Error('no compiler toolkit among the assets')
  })()
  kit.catch(() => kits.delete(env.ASSETS))
  kits.set(env.ASSETS, kit)
  return kit
}

/** What a compile of an app with this package.json is made of. */
export let used = async (
  env: Pick<Env, 'ASSETS'> & Partial<Env>,
  pkg: string | null,
): Promise<Record<string, string>> => toolkitOf(pkg, await current(env))

/// behind(null, {}) -> true
/// behind({ '@yaks/a': 'sha256:a' }, { '@yaks/a': { version: 'sha256:a', uses: [] } }) -> false
/// behind({ '@yaks/a': 'sha256:a' }, { '@yaks/a': { version: 'sha256:b', uses: [] } }) -> true
/// behind({ '@yaks/a': 'sha256:a' }, {}) -> true
/** Whether a compile that recorded `record` (null: it kept none) was made of
 * a toolkit other than `kit`: a package it reached has other source now, or
 * is gone. */
export let behind = (
  record: Record<string, string> | null,
  kit: Toolkits,
): boolean =>
  record == null ||
  Object.entries(record).some(([name, version]) =>
    kit[name]?.version != version
  )

/** Whether the release at `source` compiled anything with a toolkit this
 * platform has moved on from. A release that compiled nothing serves its
 * files as written, and has no toolkit to fall behind. */
export let stale = async (
  env: Pick<Env, 'ASSETS' | 'BLOBS'> & Partial<Env>,
  source: string,
): Promise<boolean> => {
  let files = await filesIn(r2RawObjects(env.BLOBS), source)
  if (!files?.[COMPILED]) return false
  let bytes = files[RECORD]
    ? await r2Objects(env.BLOBS).read(`${source}/${RECORD}`)
    : null
  let record = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
  return behind(record, await current(env))
}
