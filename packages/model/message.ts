// Source labels belong to prompt assembly, independent of a provider's roles.
import type { Item } from './mod.ts'

/** Render a message's author in its words, including APIs that only offer
 * user and assistant turns. An absent source leaves a person's own user turn
 * or the receiving model's own output unchanged. */
export let message = <T extends Item>(item: T, from = item.from): T => {
  let { from: _, ...body } = item
  if (!from) return body as T
  let prefix = `From ${from}:\n`
  return {
    ...body,
    ...'text' in item ? { text: prefix + item.text } : {},
    ...'output' in item ? { output: prefix + item.output } : {},
    ...'label' in item ? { label: prefix + item.label } : {},
  } as T
}
