// How an actor looks on the page: a colour and a name whose first word is the
// colour, so a column, a block and an editor are read together at a glance.
// The colour is chosen when the actor joins (the first one no other actor of
// the doc wears) and kept on its actor row; the animal comes from its key.

export let PALETTE = [
  ['Indigo', '#5b5bd6'],
  ['Coral', '#e5603e'],
  ['Jade', '#139c74'],
  ['Rose', '#d6407a'],
  ['Sky', '#1a8fd1'],
  ['Amber', '#d98a0b'],
  ['Violet', '#8a55e0'],
  ['Teal', '#0f9a95'],
]

let ANIMALS = [
  'Fox',
  'Otter',
  'Heron',
  'Lynx',
  'Wren',
  'Moth',
  'Hare',
  'Seal',
  'Finch',
  'Newt',
  'Crane',
  'Badger',
  'Owl',
  'Koi',
  'Ibex',
  'Puffin',
]

/// hash('a') -> 3826002220
/** FNV-1a over a string's char codes: a small, stable number for a key. */
export let hash = (s) =>
  [...String(s)].reduce(
    (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  )

/// look('a', '#e5603e') -> { name: 'Coral Owl', color: '#e5603e' }
/// look('a').color -> '#1a8fd1'
/**
 * An actor's name and colour from its key and the colour its actor row keeps;
 * a colour from outside the palette, or none, falls back to one from the key.
 */
export let look = (key, color) => {
  let i = PALETTE.findIndex(([, c]) => c == color)
  if (i < 0) i = hash(key) % PALETTE.length
  let [word, hex] = PALETTE[i]
  return { name: `${word} ${ANIMALS[hash(key) % ANIMALS.length]}`, color: hex }
}

/// fresh(['#5b5bd6']) -> '#e5603e'
/// fresh(PALETTE.map(([, c]) => c)) -> '#5b5bd6'
/** The first palette colour not in `taken`, or the first once all are. */
export let fresh = (taken) =>
  (PALETTE.find(([, c]) => !taken.includes(c)) ?? PALETTE[0])[1]
