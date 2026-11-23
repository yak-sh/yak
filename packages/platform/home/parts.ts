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
