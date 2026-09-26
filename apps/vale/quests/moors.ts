// The people of the south road out of Mossvale: the wall-watch of
// Stonestep, Heatherfell, Oldwall and its readable stones, the empty
// barrow of the last king, and Giantsteps, the way to the fire.
import type { Giver, Quest } from '../quests.ts'

export let givers: Giver[] = [
  {
    id: 'hale',
    name: 'Captain Hale',
    level: 'stonestep',
    place: 'steps',
    offset: [-1.5, -3],
    greets: 'The wall-watch stands. Always has.',
    look: { tint: '#6a2a2a', hair: '#4a3a2a', skin: '#c89070' },
  },
  {
    id: 'bram',
    name: 'Bram the smith',
    level: 'stonestep',
    place: 'steps',
    offset: [6.5, -1],
    greets: 'Keep your edge oiled and your feet dry.',
    look: { tint: '#5a4a42', hair: '#2a1d17', skin: '#8d5a3b' },
  },
  {
    id: 'greta',
    name: 'Greta Flint',
    level: 'stonestep',
    place: 'steps',
    offset: [1, 5],
    greets: 'Stone is patient. I try to be.',
    look: { tint: '#7d7a74', hair: '#9a9a92', skin: '#d7a283' },
  },
  {
    id: 'lark',
    name: 'Lark the shepherdess',
    level: 'heatherfell',
    place: 'moor',
    offset: [-10.5, 20],
    greets: 'The heather’s in flower. Smell that.',
    look: { tint: '#9a5a7a', hair: '#e0a050', skin: '#f0c0a0' },
    staff: true,
  },
  {
    id: 'quill',
    name: 'Scholar Quill',
    level: 'oldwall',
    place: 'ruins',
    offset: [10, 24],
    greets:
      'Did you know this wall is older than the moss? Hardly anyone knows that.',
    look: { tint: '#4a4a6a', hair: '#8a8a8a', skin: '#e0b8a0' },
  },
  {
    id: 'grey',
    name: 'Sexton Grey',
    level: 'kingsbarrow',
    place: 'barrow',
    offset: [-9.5, 31.5],
    greets: 'Quiet, now. The old king sleeps. Or he did.',
    look: { tint: '#3a3a3a', hair: '#e8e8e0', skin: '#d0b098' },
    staff: true,
  },
  {
    id: 'gorm',
    name: 'Old Gorm the stonecaller',
    level: 'giantsteps',
    place: 'moor',
    offset: [0.5, -5.5],
    greets: 'Listen. The stones are talking. They’re always talking.',
    look: { tint: '#6a6a5a', hair: '#c0c0b0', skin: '#7a5a40' },
    staff: true,
  },
]

export let quests: Quest[] = [
  // Captain Hale, of the wall-watch at Stonestep.
  {
    id: 'hale-adders',
    giver: 'hale',
    goal: 'slay',
    target: 'adder',
    count: 3,
    xp: 250,
    title: 'Adders on the moor',
    body:
      'The wall-watch walks the moor north-east of the steps, and heath adders bite a watchman a day. Three of them, and the watch walks easy.',
  },
  {
    id: 'hale-goblins',
    giver: 'hale',
    after: 'hale-adders',
    goal: 'slay',
    target: 'goblin',
    count: 5,
    xp: 420,
    title: 'Goblins on the wall',
    body:
      'Bramble goblins have started climbing the old wall at night, briar in their hair, and they throw the watch-fires down. Five of them.',
  },
  {
    id: 'hale-lynx',
    giver: 'hale',
    after: 'hale-goblins',
    goal: 'slay',
    target: 'lynx',
    count: 1,
    xp: 130,
    gift: 'draught',
    title: 'The old king’s road',
    body:
      'The road south runs on to the old king’s barrow, the south ward, and a ridge lynx has taken to hunting whoever walks it. Clear the road, then walk it: Heatherfell first, then Oldwall.',
  },
  // Bram the smith, who shoes the wall-watch at Stonestep.
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
      'Boar tusk makes the best handles there are: never slips, wet or dry. Bring me three, and I’ll stand you a tonic.',
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
      'Crag shard, ground fine, keeps an edge bright for a year. Three will do. Mind the Cragbacks up in the crags north-west of here: they don’t care for folk chipping at them.',
  },
  // Greta Flint, who cuts stone for the steps.
  {
    id: 'greta-crags',
    giver: 'greta',
    goal: 'slay',
    target: 'crag',
    count: 4,
    xp: 320,
    title: 'Walking stones',
    body:
      'Forty years I’ve cut stone for these steps, and not one stone ever got up and walked. Now they do nothing else. Topple four, so I can get back to work.',
  },
  {
    id: 'greta-hawks',
    giver: 'greta',
    after: 'greta-crags',
    goal: 'slay',
    target: 'hawk',
    count: 2,
    xp: 170,
    gift: 'tonic',
    title: 'Hawks on the quarry',
    body:
      'Ridge hawks nest on the quarry face and dive at anyone on a ladder. Two of them, and I’ll climb again.',
  },
  // Lark the shepherdess, on the moor of Heatherfell.
  {
    id: 'lark-hawks',
    giver: 'lark',
    goal: 'slay',
    target: 'hawk',
    count: 5,
    xp: 420,
    title: 'Hawks at the lambs',
    body:
      'Ridge hawks drop out of the sky and take the lambs. Five of them, and the flock can graze in the open again.',
  },
  {
    id: 'lark-bogles',
    giver: 'lark',
    after: 'lark-hawks',
    goal: 'slay',
    target: 'bogle',
    count: 3,
    xp: 420,
    title: 'Bogles by the tarn',
    body:
      'Bogles have come up by the tarn, and they tie the ewes’ tails together for a laugh. Three of them.',
  },
  {
    id: 'lark-golems',
    giver: 'lark',
    after: 'lark-bogles',
    goal: 'slay',
    target: 'golem',
    count: 2,
    xp: 720,
    gift: 'draught',
    title: 'Standing stones that walk',
    body:
      'Heatherfell’s stones have stood on the fell since before anyone. Two of them have got up and started walking, thorns growing out of their seams. Lay them back down. Oldwall is down the road south.',
  },
  // Scholar Quill, reading the ruins of Oldwall.
  {
    id: 'quill-goblins',
    giver: 'quill',
    goal: 'slay',
    target: 'goblin',
    count: 6,
    xp: 500,
    title: 'Goblins in the library',
    body:
      'This was the old kingdom’s wall, and I am reading it, stone by stone. Bramble goblins keep scratching it out. Drive off six.',
  },
  {
    id: 'quill-scorpions',
    giver: 'quill',
    after: 'quill-goblins',
    goal: 'slay',
    target: 'scorpion',
    count: 4,
    xp: 820,
    title: 'Stings in the cracks',
    body:
      'Scorpions live in the cracks of the wall, and they object to my reading. Four of them.',
  },
  {
    id: 'quill-brood',
    giver: 'quill',
    after: 'quill-scorpions',
    goal: 'slay',
    target: 'broodmother',
    count: 1,
    xp: 520,
    title: 'Webbed shut',
    body:
      'A broodmother has webbed the whole middle of the wall shut, and I need to read what is under it. Please.',
  },
  {
    id: 'quill-warchief',
    giver: 'quill',
    after: 'quill-brood',
    goal: 'slay',
    target: 'warchief',
    count: 1,
    xp: 340,
    gift: 'draught',
    title: 'The last line',
    body:
      'The wall ends with a name: the last Greenkeeper king, buried at Kingsbarrow, down the road west. A goblin warchief squats on the last stone and won’t let me read it. Move him, then go and see the barrow.',
  },
  // Sexton Grey, who keeps the barrow at Kingsbarrow.
  {
    id: 'grey-warchiefs',
    giver: 'grey',
    goal: 'slay',
    target: 'warchief',
    count: 2,
    xp: 680,
    title: 'Diggers at the barrow',
    body:
      'Goblins are digging at the barrow for the old king’s gold, and two warchiefs keep them at it. Stop them.',
  },
  {
    id: 'grey-golems',
    giver: 'grey',
    after: 'grey-warchiefs',
    goal: 'slay',
    target: 'golem',
    count: 3,
    xp: 1080,
    title: 'The guards that let them in',
    body:
      'The barrow’s stone guards have woken with briar in them, and they let the robbers in. Three of them, and I can sweep up.',
  },
  {
    id: 'grey-scarabs',
    giver: 'grey',
    after: 'grey-golems',
    goal: 'slay',
    target: 'scarab',
    count: 6,
    xp: 1580,
    title: 'Beetles in the hall',
    body:
      'Tomb scarabs have got into the old hall south-east of here. They eat the dead, and they don’t much mind the living. Six of them.',
  },
  {
    id: 'grey-basilisk',
    giver: 'grey',
    after: 'grey-scarabs',
    goal: 'slay',
    target: 'basilisk',
    count: 1,
    xp: 580,
    gift: 'draught',
    title: 'An empty grave',
    body:
      'I have seen inside the barrow now. The king is not in it. The stones say he went under the old woods, into the crystal, to cut out the briar’s root. Kill the basilisk on his door, and if you ever go under, look for him.',
  },
  // Old Gorm the stonecaller, on the moor at Giantsteps.
  {
    id: 'gorm-ore',
    giver: 'gorm',
    goal: 'gather',
    target: 'ore',
    count: 6,
    xp: 1770,
    title: 'Iron for the steps',
    body:
      'The giants bound these steps with iron, and the briar has eaten it through. Six lumps of ore to mend them. The stonewyrms and the golems carry it.',
  },
  {
    id: 'gorm-wyrms',
    giver: 'gorm',
    after: 'gorm-ore',
    goal: 'slay',
    target: 'stonewyrm',
    count: 4,
    xp: 820,
    title: 'Wyrms in the steps',
    body:
      'Giants cut these steps, and stonewyrms nest in them. Four of them have briar growing out of their scales. Put them down.',
  },
  {
    id: 'gorm-basilisks',
    giver: 'gorm',
    after: 'gorm-wyrms',
    goal: 'slay',
    target: 'basilisk',
    count: 2,
    xp: 1160,
    title: 'Eyes in the scree',
    body:
      'Two basilisks sit in the scree and turn the stones to look at you. I don’t like being looked at by stones. Two of them.',
  },
  {
    id: 'gorm-wight',
    giver: 'gorm',
    after: 'gorm-basilisks',
    goal: 'slay',
    target: 'wight',
    count: 1,
    xp: 710,
    gift: 'draught',
    title: 'A giant’s shadow',
    body:
      'Something walks the steps at night that isn’t a giant and isn’t alive. A wight, crowned in briar. Let it rest. Then listen to the stones: they say the briar’s root lies in the fire, down the road to Emberfall.',
  },
]
