export const SECTIONS = [
  'hello',
  'how',
  'integrations',
  'work',
  'email-in',
  'payments',
  'helpers',
  'people',
  'domains',
] as const

export const POSES = {
  change: 'typing',
  connect: 'plug',
  send: 'plane',
  receive: 'letter',
  sell: 'calculating',
  helper: 'thinking',
  team: 'wave',
  domain: 'flag',
} as const

/** The supplied logos of the two example services the integrations catalog does not serve. */
export const BRANDS = ['stripe', 'zoom'] as const
