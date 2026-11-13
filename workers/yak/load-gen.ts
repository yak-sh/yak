// What gen.ts writes into load.ts beyond what @yaks/workerd/gen writes for
// any Worker: every package's words. Pure: gen.ts reads the manifests and
// owns the generated files.
import type { Manifest } from '@yaks/workerd/gen'

/** Every package's `./vocab`, configured or not: an app names any of them as a
 * `"platform"` dependency, and its store speaks their words (vocab.ts
 * `lent`). A Worker cannot import a facet it was not bundled with. */
export let vocabs = (manifests: Manifest[]): string[] =>
  manifests.filter((m) =>
    m.name?.startsWith('@yaks/') && typeof m.exports == 'object' &&
    Object.hasOwn(m.exports, './vocab')
  ).map((m) => `${m.name}/vocab`)
