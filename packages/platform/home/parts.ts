/** Each feature a landing page's story can tell, by its name: the id of its
 * section, which the tabs and the phone's messages jump to, the poses the
 * yak plays beside it (mascot/<pose>.webp), and the points (`point1`…) its
 * words list under it. A page tells the ones it names, in its order, `build`
 * first as the hero (mod.tsx `Landing`). */
export const FEATURES = {
  build: { section: 'hello', poses: [], points: [] },
  change: { section: 'how', poses: ['typing'], points: [2, 3] },
  connect: { section: 'integrations', poses: ['plug'], points: [1, 2, 3] },
  email: { section: 'work', poses: ['plane', 'letter'], points: [1, 2, 3] },
  sell: { section: 'payments', poses: ['calculating'], points: [1, 2, 3] },
  helper: { section: 'helpers', poses: ['thinking'], points: [1, 2, 3] },
  team: { section: 'people', poses: ['wave'], points: [1, 3] },
  domain: { section: 'domains', poses: ['flag'], points: [1, 2] },
} as const

/** A feature, by its name. */
export type Feature = keyof typeof FEATURES

/** Every feature's section id. */
export const SECTIONS = Object.values(FEATURES).map((f) => f.section)

/** Every pose a feature's yak plays. */
export const POSES = [
  ...new Set(Object.values(FEATURES).flatMap((f) => f.poses)),
]

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
