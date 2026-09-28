// Small, pure readers for the app store's bundles, shared by the page and
// the companion's server tick.
import type { Bundle } from './net.ts'

export let comp = (
  b: Bundle | undefined,
  name: string,
): Record<string, unknown> => {
  let c = b?.[name]
  return c && typeof c == 'object' ? c : {}
}
export let num = (v: unknown, or = 0): number => typeof v == 'number' ? v : or
export let str = (v: unknown, or = ''): string => typeof v == 'string' ? v : or
