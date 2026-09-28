// The health command for the hero this tab plays. The store checks that its
// caller owns the space before it changes the hero's invulnerability.
import type { Net } from './net.ts'

export let healthMode = async (net: Net, on: boolean): Promise<string> => {
  if (!net.hero) throw new Error('Choose a hero before changing health.')
  let { pending } = await net.write({
    entity: { eid: net.hero },
    invulnerable: { on },
  })
  return pending
    ? 'Health change queued; it will take effect when Mossvale is back online.'
    : on
    ? 'Health on. Your hero cannot be hurt.'
    : 'Health off. Your hero can be hurt again.'
}
