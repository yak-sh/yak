export const SECTIONS = [
  'hello',
  'how',
  'integrations',
  'work',
  'payments',
  'helpers',
  'people',
  'domains',
] as const

export const POSES = {
  change: ['typing'],
  connect: ['plug'],
  email: ['plane', 'letter'],
  sell: ['calculating'],
  helper: ['thinking'],
  team: ['wave'],
  domain: ['flag'],
} as const

/** The supplied logos of the two example services the integrations catalog does not serve. */
export const BRANDS = ['stripe', 'zoom'] as const

/** What the hero's yak does as he is clicked (yak.js), a step a click: the
 * pose he plays once (mascot/<pose>.webp, `ms` long), and what the step does
 * besides saying its line. `start` types the start of an idea into the box,
 * `point` nudges its button; the last step is the one every click after the
 * run plays. */
export const RUN = [
  { pose: 'wave', ms: 2500 },
  { pose: 'thinking', ms: 2950 },
  { pose: 'calculating', ms: 2750 },
  { pose: 'plane', ms: 3150 },
  { pose: 'typing', ms: 2600, act: 'start' },
  { pose: 'flag', ms: 3000, act: 'point' },
] as const
