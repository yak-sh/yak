// The damage command for the hero this tab plays. The store checks that its
// caller owns the space before it changes whether damage can reach the hero.
import type { Net } from './net.ts'

export let damageMode = async (net: Net, on: boolean): Promise<string> => {
  if (!net.hero) throw new Error('Choose a hero before changing damage.')
  let { pending } = await net.write({
    entity: { eid: net.hero },
    damage: { on },
  })
  return pending
    ? 'Damage change queued; it will take effect when Mossvale is back online.'
    : on
    ? 'Damage on. Your hero can be hurt again.'
    : 'Damage off. Your hero cannot be hurt.'
}
