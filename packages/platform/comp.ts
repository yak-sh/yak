/** A revocable tier granted by the platform, independent of a subscription. */
export type Comp = { tier: 'plus' | 'pro'; reason: string; by: string }

/** The effective tier and any operational comp on a named space. */
export type SpaceComp = {
  space: string
  tier: 'free' | 'plus' | 'pro' | null
  comp: Comp | null
}
