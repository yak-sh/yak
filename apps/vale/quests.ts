// What the people of the vale ask of a player, and who they are. Pure data: a
// quest is a row of QUESTS and its giver a row of GIVERS, who stands at a
// place of a level (levels.ts). A giver offers their quests one at a time,
// each once the quest it comes `after` is done. A quest names what to slay by
// creature kind (beasts.ts) and what to gather or give by item kind
// (items.ts). Its id is what a player's journal remembers, so an id, once
// played, never changes.

export type Giver = {
  id: string
  name: string
  /** the level they live in, and the place in it (levels.ts) */
  level: string
  place: string
  /** where they stand from that place, in metres east and south */
  offset: [number, number]
  /** what they say when there is nothing to ask */
  greets: string
  look: { tint: string; hair: string; skin: string }
  /** leans on a staff */
  staff?: boolean
}

export type Quest = {
  id: string
  giver: string
  /** the quest that must be done first */
  after?: string
  goal: 'slay' | 'gather'
  /** a creature kind to slay, or an item kind to gather and hand over */
  target: string
  count: number
  xp: number
  /** an item kind given on completion */
  gift?: string
  title: string
  body: string
}

export let GIVERS: Giver[] = [
  {
    id: 'wren',
    name: 'Elder Wren',
    level: 'mossvale',
    place: 'plaza',
    offset: [-1.5, -3],
    greets: 'The vale is quieter for your blade. Sit by the fire a while.',
    look: { tint: '#4f7a4a', hair: '#e9e6df', skin: '#d9a98a' },
    staff: true,
  },
]

export let QUESTS: Quest[] = [
  {
    id: 'wren-jelly',
    giver: 'wren',
    goal: 'gather',
    target: 'jelly',
    count: 4,
    xp: 60,
    gift: 'tonic',
    title: 'Jelly for the kettle',
    body:
      'The moss slimes out in the meadow are fat with jelly this season. Bring me four and I will brew you a tonic that mends a bruise or two.',
  },
  {
    id: 'wren-boars',
    giver: 'wren',
    after: 'wren-jelly',
    goal: 'slay',
    target: 'boar',
    count: 4,
    xp: 140,
    gift: 'blade2',
    title: 'Bristles in the turnips',
    body:
      'Bristleboars are rooting up the edge of Whisperwood, north of here, and my turnips with it. Drive off four of them, and take my old blade, Boarsbane, for your trouble.',
  },
  {
    id: 'wren-crags',
    giver: 'wren',
    after: 'wren-boars',
    goal: 'slay',
    target: 'crag',
    count: 3,
    xp: 260,
    gift: 'blade3',
    title: 'The stones that walk',
    body:
      'Up in Craghollow, to the south-west, the rocks have started walking. Cragbacks, the old folk called them. Topple three, and this cleaver is yours.',
  },
  {
    id: 'wren-thornback',
    giver: 'wren',
    after: 'wren-crags',
    goal: 'slay',
    target: 'thornback',
    count: 1,
    xp: 700,
    gift: 'tonic',
    title: 'Old Thornback',
    body:
      'Something old nests on Thornback Ridge, south-east of the village, and every beast in the vale is restless because of it. Take friends. Take tonics. Come back.',
  },
]
