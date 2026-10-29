/** Historical drivers read stamps from the product revision that owns them:
 * either kernel's declarations or the extracted provenance package. */
import type { VocabDoc } from '@yaks/vocab'

export let stamps = async (
  docs: VocabDoc[],
  root?: string,
): Promise<VocabDoc[]> => {
  if (
    ['created', 'updated'].every((name) =>
      docs.some((doc) => doc.$defs?.[name])
    )
  ) {
    return []
  }
  let path = root
    ? `${root}/packages/provenance/vocab.ts`
    : new URL('../packages/provenance/vocab.ts', import.meta.url).href
  return (await import(path)).docs
}
