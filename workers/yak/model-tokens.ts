// Catalogue limits can grow without a release; one hosted turn stays bounded.
import type { Listed } from '@yaks/model'

export let outputTokens = (
  info?: Pick<Listed, 'output'>,
  requested?: number,
): number => {
  let output = info?.output
  let listed = output != null && Number.isSafeInteger(output) && output > 0
    ? output
    : undefined
  return Math.min(requested ?? listed ?? 4096, listed ?? 65_536, 65_536)
}
