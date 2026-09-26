// What the people of the vale ask of a player, and who they are. Pure data: a
// quest is a row of QUESTS and its giver a row of GIVERS, who stands at a
// place of a level (levels.ts). A giver offers their quests one at a time,
// each once the quest it comes `after` is done, which may be another giver's:
// that is how a story walks a player from one person, and one level, to the
// next. A quest names what to slay by creature kind (beasts.ts) and what to
// gather or give by item kind (items.ts). Its id is what a player's journal
// remembers, so an id, once played, never changes.
//
// The story they tell: a briar is creeping into the vale from somewhere far
// off, and a beast it crowns forgets it was ever gentle. Long ago the
// Greenkeepers planted the moss and held the briar back. Elder Wren's quests
// are the spine, from Mossvale outward; everyone else has troubles of their
// own, and most of those troubles have thorns in them.

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
  // Mossvale
  {
    id: 'wren',
    name: 'Elder Wren',
    level: 'mossvale',
    place: 'plaza',
    offset: [-1.5, -3],
    greets:
      'The vale is quieter for your blade. Sit by the fire a while, and when you are rested, the Reeve is waiting in Birchmere, through the mossy gate east of here.',
    look: { tint: '#4f7a4a', hair: '#e9e6df', skin: '#d9a98a' },
    staff: true,
  },
  {
    id: 'pip',
    name: 'Pip',
    level: 'mossvale',
    place: 'plaza',
    offset: [1, 5],
    greets: 'When I’m big I’m going to have a sword just like yours.',
    look: { tint: '#d9824a', hair: '#6b3f22', skin: '#f0c4a0' },
  },
  {
    id: 'bram',
    name: 'Bram the smith',
    level: 'mossvale',
    place: 'plaza',
    offset: [6.5, -1],
    greets: 'Keep your edge oiled and your feet dry.',
    look: { tint: '#5a4a42', hair: '#2a1d17', skin: '#8d5a3b' },
  },
  {
    id: 'marigold',
    name: 'Marigold Furrow',
    level: 'mossvale',
    place: 'fields',
    offset: [-6, 4],
    greets: 'Rows are straight, fence is up. A good day in the fields.',
    look: { tint: '#c9a23a', hair: '#b5562a', skin: '#e8b58f' },
  },
  {
    id: 'hollis',
    name: 'Hollis the woodward',
    level: 'mossvale',
    place: 'woods',
    offset: [-21, 12],
    greets: 'Listen to the trees a while. They say more than folk think.',
    look: { tint: '#3f6b3a', hair: '#7a5a3a', skin: '#c68c64' },
  },
  {
    id: 'greta',
    name: 'Greta Flint',
    level: 'mossvale',
    place: 'crags',
    offset: [7.5, -28],
    greets: 'Stone is patient. I try to be.',
    look: { tint: '#7d7a74', hair: '#9a9a92', skin: '#d7a283' },
  },
  {
    id: 'tamsin',
    name: 'Old Tamsin',
    level: 'mossvale',
    place: 'lake',
    offset: [13, 7.5],
    greets: 'Sit. The fish don’t mind company, so long as it’s quiet.',
    look: { tint: '#3f6f8f', hair: '#d8d4cc', skin: '#b77b55' },
    staff: true,
  },
  {
    id: 'ash',
    name: 'Warden Ash',
    level: 'mossvale',
    place: 'ridge',
    offset: [-19, -14],
    greets: 'Eyes on the ridge. Always.',
    look: { tint: '#4a5a3a', hair: '#3a2a20', skin: '#6e4630' },
  },

  // Birchmere
  {
    id: 'alder',
    name: 'Reeve Alder',
    level: 'birchmere',
    place: 'green',
    offset: [-1.5, -3],
    greets:
      'Welcome to Birchmere. Any friend of Wren’s eats at my table, though she never writes.',
    look: { tint: '#6b5a8a', hair: '#cfcac0', skin: '#c9926e' },
    staff: true,
  },
  {
    id: 'sorrel',
    name: 'Sorrel the herbwife',
    level: 'birchmere',
    place: 'green',
    offset: [6.5, -1],
    greets: 'Mint for the head, moss for the heart, jelly for nearly anything.',
    look: { tint: '#7aa04a', hair: '#e0b05a', skin: '#f1c9a5' },
  },
  {
    id: 'mira',
    name: 'Mira of the mere',
    level: 'birchmere',
    place: 'mere',
    offset: [13, -8],
    greets: 'The mere is clear today. You can see all the way down.',
    look: { tint: '#4a8a9a', hair: '#1f1a18', skin: '#a86e4c' },
  },
  {
    id: 'fenn',
    name: 'Fenn the shepherd',
    level: 'birchmere',
    place: 'fields',
    offset: [8, 6],
    greets: 'The flock is grazing. That’s all a shepherd ever wants.',
    look: { tint: '#a07850', hair: '#e6e2da', skin: '#dca888' },
    staff: true,
  },
  {
    id: 'hazel',
    name: 'Hazel the woodcutter',
    level: 'birchmere',
    place: 'woods',
    offset: [-5, 19.5],
    greets: 'Mind the chips. They fly further than you think.',
    look: { tint: '#8a4a3a', hair: '#4a2e1c', skin: '#e2b08a' },
  },
  {
    id: 'cobb',
    name: 'Cobb the charcoal-burner',
    level: 'birchmere',
    place: 'east',
    offset: [-25, 0],
    greets: 'Smoke’s low and steady. Kilns are happy.',
    look: { tint: '#3a3a3a', hair: '#1a1a1a', skin: '#9a6848' },
  },
]

/** Every quest can be finished: its giver stands in a place that exists, the
 * quest it comes after is one, and what it asks for lives somewhere or drops
 * from something or is given.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { BEASTS } from './beasts.ts'
 * import { ITEMS } from './items.ts'
 * import { LEVELS } from './levels.ts'
 * let kinds = new Set(
 *   Object.values(LEVELS).flatMap((l) =>
 *     Object.values(l.places).map((p) => p.kind)
 *   ),
 * )
 * let lives = (k: string) => BEASTS[k]?.haunts.some((h) => kinds.has(h.near))
 * let had = new Set([
 *   ...Object.values(BEASTS).flatMap((b) => b.loot.map(([i]) => i)),
 *   ...QUESTS.map((q) => q.gift),
 * ])
 * let ids = new Set(QUESTS.map((q) => q.id))
 * let stands = (id: string) =>
 *   GIVERS.some((g) => g.id == id && LEVELS[g.level]?.places[g.place])
 * let stuck = QUESTS.filter((q) =>
 *   !stands(q.giver) || (q.after && !ids.has(q.after)) ||
 *   (q.gift && !ITEMS[q.gift]) ||
 *   (q.goal == 'slay' ? !lives(q.target) : !had.has(q.target))
 * )
 * assertEquals(stuck.map((q) => q.id), [])
 * assertEquals(ids.size, QUESTS.length)
 * ```
 */
export let QUESTS: Quest[] = [
  // Mossvale: Elder Wren, the spine of the story.
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
  {
    id: 'wren-crown',
    giver: 'wren',
    after: 'wren-thornback',
    goal: 'gather',
    target: 'crown',
    count: 1,
    xp: 300,
    gift: 'tonic',
    title: 'A crown of briar',
    body:
      'Old Thornback did not grow that crown. Somebody set it on him. I have seen its like once, drawn in the Reeve’s old book in Birchmere. Give it here, then go through the mossy gate east of the fire and show Alder what you found.',
  },

  // Mossvale: Pip, who wants to be you.
  {
    id: 'pip-jelly',
    giver: 'pip',
    goal: 'gather',
    target: 'jelly',
    count: 2,
    xp: 35,
    title: 'Bouncier than a ball',
    body:
      'Slime jelly bounces higher than anything! Mam says I can’t go past the lamps. Could you bring me two? I’ll share.',
  },
  {
    id: 'pip-slimes',
    giver: 'pip',
    after: 'pip-jelly',
    goal: 'slay',
    target: 'slime',
    count: 5,
    xp: 70,
    title: 'The ball that got away',
    body:
      'A slime swallowed my ball, down past the last lamp. I don’t know which one. If you pop five, it has to be in one of them, right?',
  },
  {
    id: 'pip-tusk',
    giver: 'pip',
    after: 'pip-slimes',
    goal: 'gather',
    target: 'tusk',
    count: 1,
    xp: 60,
    title: 'Something to show at the well',
    body:
      'The big kids say a real hero carries a boar tusk. The boars live in Whisperwood, north of the village. I only want to hold one. Just to hold.',
  },
  {
    id: 'pip-shard',
    giver: 'pip',
    after: 'pip-tusk',
    goal: 'gather',
    target: 'shard',
    count: 1,
    xp: 140,
    title: 'Does it glow?',
    body:
      'Gran says crag shards glow when the moon is up. Craghollow is south-west, and I’m not allowed. Could you bring me one, so I can stay up and see?',
  },
  {
    id: 'pip-tonic',
    giver: 'pip',
    after: 'pip-shard',
    goal: 'gather',
    target: 'tonic',
    count: 1,
    xp: 150,
    title: 'Gran’s cough',
    body:
      'Gran’s cough is back. The Elder’s tonic always helps, but Gran won’t ask for one. Could you bring one? Don’t tell her it was me.',
  },

  // Mossvale: Bram the smith, by the well.
  {
    id: 'bram-tusks',
    giver: 'bram',
    goal: 'gather',
    target: 'tusk',
    count: 3,
    xp: 160,
    gift: 'tonic',
    title: 'Handles and hilts',
    body:
      'Boar tusk makes the best handles in the vale: it never slips, wet or dry. Bring me three from the Whisperwood herd, north of here, and I’ll stand you a tonic.',
  },
  {
    id: 'bram-shards',
    giver: 'bram',
    after: 'bram-tusks',
    goal: 'gather',
    target: 'shard',
    count: 3,
    xp: 400,
    title: 'Grit for the grindstone',
    body:
      'Crag shard, ground fine, keeps an edge bright for a year. Three will do. Mind the Cragbacks in Craghollow: they don’t care for folk chipping at them.',
  },
  {
    id: 'bram-crags',
    giver: 'bram',
    after: 'bram-shards',
    goal: 'slay',
    target: 'crag',
    count: 4,
    xp: 320,
    gift: 'tonic',
    title: 'A bad ring in the stone',
    body:
      'Every shard you brought rings wrong on the anvil, as if there were thorn in the grain. Stone doesn’t grow thorns. Put down four more Cragbacks and tell me if the hollow sounds the same.',
  },

  // Mossvale: Marigold Furrow, in the east fields.
  {
    id: 'marigold-slimes',
    giver: 'marigold',
    goal: 'slay',
    target: 'slime',
    count: 6,
    xp: 85,
    title: 'Slimes in the cabbages',
    body:
      'They slide over from the village meadow at night and leave the cabbages sticky. Six of them, please, and the rest might take the hint.',
  },
  {
    id: 'marigold-jelly',
    giver: 'marigold',
    after: 'marigold-slimes',
    goal: 'gather',
    target: 'jelly',
    count: 5,
    xp: 90,
    gift: 'tonic',
    title: 'Good for the soil',
    body:
      'Don’t tell the Elder, but slime jelly makes the best compost in the vale. Five will see my rows through the summer, and here’s a tonic for your trouble.',
  },
  {
    id: 'marigold-boars',
    giver: 'marigold',
    after: 'marigold-jelly',
    goal: 'slay',
    target: 'boar',
    count: 5,
    xp: 170,
    title: 'Tusks through the fence',
    body:
      'Bristleboars come down out of Whisperwood, off to the north-west, and go through my fence like it’s straw. Drive off five before they find the turnips.',
  },
  {
    id: 'marigold-tonic',
    giver: 'marigold',
    after: 'marigold-boars',
    goal: 'gather',
    target: 'tonic',
    count: 2,
    xp: 300,
    title: 'Tom’s fever',
    body:
      'My Tom has a fever and he’s too proud to walk to the Elder. Two tonics would set him right. Bristleboars and Cragbacks carry them, now and then, and Wren gives them for good work.',
  },

  // Mossvale: Hollis the woodward, at the edge of Whisperwood.
  {
    id: 'hollis-boars',
    giver: 'hollis',
    after: 'wren-jelly',
    goal: 'slay',
    target: 'boar',
    count: 5,
    xp: 170,
    title: 'A restless herd',
    body:
      'The herd in Whisperwood used to shy at a snapped twig. Now they charge a woodward with his axe up. Five of them, before somebody’s hurt.',
  },
  {
    id: 'hollis-tusks',
    giver: 'hollis',
    after: 'hollis-boars',
    goal: 'gather',
    target: 'tusk',
    count: 4,
    xp: 210,
    gift: 'tonic',
    title: 'Thorns in the tusk',
    body:
      'Look at this tusk. See the thorn grown right into it? Bring me four more. I want to know if it’s one sick boar or the whole herd.',
  },
  {
    id: 'hollis-herd',
    giver: 'hollis',
    after: 'hollis-tusks',
    goal: 'slay',
    target: 'boar',
    count: 10,
    xp: 340,
    title: 'Every one of them',
    body:
      'Every tusk had thorns in it. Whatever is in them is spreading, and the trees say it comes from the south-east, where the old boar sleeps. Thin the herd by ten, and tell the Elder what I found.',
  },

  // Mossvale: Greta Flint, above Craghollow.
  {
    id: 'greta-crags',
    giver: 'greta',
    after: 'wren-boars',
    goal: 'slay',
    target: 'crag',
    count: 4,
    xp: 320,
    title: 'Walking stones',
    body:
      'Forty years I’ve cut stone in Craghollow, and not one stone ever got up and walked. Now they do nothing else. Topple four, so I can get back to work.',
  },
  {
    id: 'greta-shards',
    giver: 'greta',
    after: 'greta-crags',
    goal: 'gather',
    target: 'shard',
    count: 4,
    xp: 530,
    gift: 'tonic',
    title: 'What they are made of',
    body:
      'A Cragback breaks into shards that glow blue, like nothing I ever quarried. Bring me four. I want to see what is at the heart of one.',
  },
  {
    id: 'greta-deep',
    giver: 'greta',
    after: 'greta-shards',
    goal: 'slay',
    target: 'crag',
    count: 8,
    xp: 640,
    title: 'A briar in the stone',
    body:
      'Every shard had a thread of thorn at its heart, fine as hair. Something is growing through the rock and waking it. Bring down eight more and keep the hollow quiet while I send word to the Elder.',
  },

  // Mossvale: Old Tamsin, fishing on the east shore of the lake.
  {
    id: 'tamsin-bait',
    giver: 'tamsin',
    goal: 'gather',
    target: 'jelly',
    count: 3,
    xp: 55,
    title: 'The best bait',
    body:
      'Slime jelly is the best bait there ever was. My knees won’t take me up to the village, east of here, so bring me three, and I’ll tell you a story while the float bobs.',
  },
  {
    id: 'tamsin-slimes',
    giver: 'tamsin',
    after: 'tamsin-bait',
    goal: 'slay',
    target: 'slime',
    count: 8,
    xp: 110,
    title: 'Slimes on the shore',
    body:
      'They slide down from the meadow to drink, and then the fish won’t bite. Pop eight of them, and I’ll tell you about the Greenkeepers.',
  },
  {
    id: 'tamsin-stones',
    giver: 'tamsin',
    after: 'tamsin-slimes',
    goal: 'gather',
    target: 'shard',
    count: 2,
    xp: 270,
    gift: 'tonic',
    title: 'The Greenkeepers',
    body:
      'Long ago the Greenkeepers planted the moss of this vale, and the beasts grew gentle in it. They set crag shards round the lake to keep the briar out, and the shards are long gone. Bring me two, and I’ll set them back.',
  },

  // Mossvale: Warden Ash, below Thornback Ridge.
  {
    id: 'ash-boars',
    giver: 'ash',
    after: 'wren-boars',
    goal: 'slay',
    target: 'boar',
    count: 6,
    xp: 200,
    title: 'Ranging south',
    body:
      'Since the old boar woke, every beast in the vale is on edge, and the Whisperwood herd has started ranging far from home. Drive off six before they run through the village.',
  },
  {
    id: 'ash-watch',
    giver: 'ash',
    after: 'wren-thornback',
    goal: 'slay',
    target: 'thornback',
    count: 1,
    xp: 600,
    title: 'He came back',
    body:
      'You put Old Thornback down. I saw it. And this morning he was up on the ridge again, south-east of here, crown and all. Put him down once more, and I’ll watch where he rises.',
  },
  {
    id: 'ash-crowns',
    giver: 'ash',
    after: 'ash-watch',
    goal: 'gather',
    target: 'crown',
    count: 2,
    xp: 1200,
    gift: 'tonic',
    title: 'Burn the briar',
    body:
      'He rises where the thorns are thickest, and the crown grows back every time. Bring me two of those crowns. I mean to burn them, and see if he stays down.',
  },

  // Birchmere: Reeve Alder, who keeps the old book.
  {
    id: 'alder-thorns',
    giver: 'alder',
    after: 'wren-crown',
    goal: 'slay',
    target: 'boar',
    count: 6,
    xp: 210,
    gift: 'tonic',
    title: 'The Reeve of Birchmere',
    body:
      'So Wren sent you, and with a briar crown. Our boars in Emberwood, south-east of the green, have thorns in their hides, the same. Drive off six, and I’ll open the old book for you.',
  },
  {
    id: 'alder-tusks',
    giver: 'alder',
    after: 'alder-thorns',
    goal: 'gather',
    target: 'tusk',
    count: 5,
    xp: 260,
    title: 'Proof for the council',
    body:
      'The council laughs at thorns in a boar. It won’t laugh at five tusks on the table, thorns and all. Bring them, and we’ll see who laughs.',
  },
  {
    id: 'alder-ring',
    giver: 'alder',
    after: 'alder-tusks',
    goal: 'gather',
    target: 'shard',
    count: 3,
    xp: 400,
    gift: 'tonic',
    title: 'The Greenkeepers’ ring',
    body:
      'The book says the Greenkeepers held the briar back with a ring of crag shards. There are no crags in Birchmere. Go back through the gate to Craghollow and bring me three.',
  },

  // Birchmere: Sorrel the herbwife, by the well.
  {
    id: 'sorrel-jelly',
    giver: 'sorrel',
    goal: 'gather',
    target: 'jelly',
    count: 6,
    xp: 100,
    gift: 'tonic',
    title: 'Jelly and patience',
    body:
      'A tonic is mostly slime jelly and patience. I have the patience. Six jellies, and one of the tonics is yours.',
  },
  {
    id: 'sorrel-slimes',
    giver: 'sorrel',
    after: 'sorrel-jelly',
    goal: 'slay',
    target: 'slime',
    count: 10,
    xp: 140,
    title: 'In the herb beds',
    body:
      'The slimes have found my herb beds, and they don’t leave much. Ten of them, please, and step softly round the mint.',
  },
  {
    id: 'sorrel-tusks',
    giver: 'sorrel',
    after: 'sorrel-slimes',
    goal: 'gather',
    target: 'tusk',
    count: 2,
    xp: 110,
    gift: 'tonic',
    title: 'A poultice for the flock',
    body:
      'Fenn’s sheep keep getting gored. Boar tusk, ground fine, draws the swelling out. Two tusks, and take a tonic for the road.',
  },

  // Birchmere: Mira of the mere.
  {
    id: 'mira-slimes',
    giver: 'mira',
    goal: 'slay',
    target: 'slime',
    count: 8,
    xp: 110,
    title: 'Clouded water',
    body:
      'Slimes slide into the mere to cool off and cloud it green for days. Clear eight of them off the shore, and the water will settle.',
  },
  {
    id: 'mira-jelly',
    giver: 'mira',
    after: 'mira-slimes',
    goal: 'gather',
    target: 'jelly',
    count: 4,
    xp: 70,
    title: 'Lamps for the jetty',
    body:
      'Slime jelly glows a little in a jar after dark. Four jars along the jetty, and the boats find their way home.',
  },

  // Birchmere: Fenn the shepherd, in the north-west fields.
  {
    id: 'fenn-boars',
    giver: 'fenn',
    goal: 'slay',
    target: 'boar',
    count: 6,
    xp: 200,
    title: 'Sheep in a panic',
    body:
      'The boars come out of the Whitebirches, off to the east, and run my sheep ragged. They never used to. Six of them, and my flock might eat again.',
  },
  {
    id: 'fenn-tusks',
    giver: 'fenn',
    after: 'fenn-boars',
    goal: 'gather',
    target: 'tusk',
    count: 3,
    xp: 160,
    gift: 'tonic',
    title: 'A fence of tusks',
    body:
      'An old trick: tusks set in the gatepost, points out. A boar smells its own kind and turns away. Three should do the gate.',
  },

  // Birchmere: Hazel the woodcutter, below the Whitebirches.
  {
    id: 'hazel-boars',
    giver: 'hazel',
    goal: 'slay',
    target: 'boar',
    count: 8,
    xp: 270,
    title: 'Axes down',
    body:
      'We can’t fell a birch without a Bristleboar coming at us out of the bracken. Eight of them, and we’ll get back to work.',
  },
  {
    id: 'hazel-herd',
    giver: 'hazel',
    after: 'hazel-boars',
    goal: 'slay',
    target: 'boar',
    count: 12,
    xp: 410,
    gift: 'tonic',
    title: 'More every morning',
    body:
      'There are more every morning, with thorns in their bristles, and they come from beyond the hills. Twelve this time, and I’ll mark on the Reeve’s map where the tracks lead.',
  },

  // Birchmere: Cobb the charcoal-burner, in Emberwood.
  {
    id: 'cobb-boars',
    giver: 'cobb',
    goal: 'slay',
    target: 'boar',
    count: 5,
    xp: 170,
    title: 'Smoke and tusks',
    body:
      'The smoke used to keep the boars off my kilns. Now it draws them. Five of them, before they kick a kiln over and the whole wood goes up.',
  },
  {
    id: 'cobb-tusks',
    giver: 'cobb',
    after: 'cobb-boars',
    goal: 'gather',
    target: 'tusk',
    count: 4,
    xp: 210,
    title: 'Where they have been',
    body:
      'Burn a tusk, my gran said, and the smoke tells you where it’s been. Bring me four from these Emberwood boars. I want to know where they have been.',
  },
]
