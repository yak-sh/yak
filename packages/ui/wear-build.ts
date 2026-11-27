// The stock Linen composition, served from the same package directory as its
// source sheets so each relative URL resolves exactly as it did before.
import { text } from '@yaks/api/asset'
import { linenAddresses, linenAsset } from './kit.ts'

export let wearAssets = async (
  read = text,
): Promise<Record<string, string>> => ({
  [linenAsset]: (await Promise.all(
    linenAddresses().map((href) => read(new URL(href))),
  )).join('\n'),
})
