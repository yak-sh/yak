// The words the Operator chat page's graph holds (operator-talk.ts): the
// Operator store's components as its vocabulary declares them, without what
// only a store reads (its rules, effects and tools) or what only a person
// reads (descriptions), so a page holds the store's rows as the store keeps
// them. Written beside the page's scripts at deploy as `_words.js`
// (client-assets.ts), the same for every page and kept by the browser.
import type { VocabDoc } from '@yaks/vocab'

type Schema = Record<string, unknown>

// What a schema writes for a person: a description, a title, examples. A
// property of one of those names is declared as a schema of its own, an
// object, so it stays.
let annotation = (key: string, value: unknown) =>
  ['description', 'title', '$comment'].includes(key) &&
    typeof value == 'string' ||
  key == 'examples' && Array.isArray(value)

let bare = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(bare)
  if (!node || typeof node != 'object') return node
  return Object.fromEntries(
    Object.entries(node as Schema).flatMap(([key, value]) =>
      annotation(key, value) ? [] : [[key, bare(value)]]
    ),
  )
}

/** The components of `docs`, each as a page's graph needs it. */
export let pageDocs = (docs: VocabDoc[]): VocabDoc[] =>
  docs.flatMap((doc) => {
    let defs = Object.entries(doc.$defs ?? {}).filter(([, def]) =>
      (def as Schema).component
    )
    return defs.length
      ? [{
        ...doc.$vocabulary ? { $vocabulary: doc.$vocabulary } : {},
        $defs: Object.fromEntries(defs.map(([name, def]) => [name, bare(def)])),
      } as VocabDoc]
      : []
  })
