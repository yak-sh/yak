// The people of the far south, down the road past Giantsteps: the forge
// at Emberfall, the ash-walkers of Cinderreach, the last knight of
// Ashkeep, and the Maw, where the Cinder Wyrm lies on the briar’s root.
import type { Giver, Quest } from '../quests.ts'

export let givers: Giver[] = [
  {
    id: 'brannagh',
    name: 'Brannagh the forgewife',
    level: 'emberfall',
    place: 'forge',
    offset: [-1.5, -3],
    greets: 'The forge never goes out. Neither do I.',
    look: { tint: '#3a2a2a', hair: '#c04a1a', skin: '#b07050' },
  },
  {
    id: 'ashby',
    name: 'Ashby the bellows-boy',
    level: 'emberfall',
    place: 'forge',
    offset: [-2, 6],
    greets: 'Pump, pump, pump. My arms are bigger than yours, I bet.',
    look: { tint: '#8a3a1a', hair: '#1a1a1a', skin: '#c08060' },
  },
  {
    id: 'cole',
    name: 'Cole the ash-walker',
    level: 'cinderreach',
    place: 'ash',
    offset: [-4, 3],
    greets: 'Walk light. The ground here remembers every step.',
    look: { tint: '#5a5a5a', hair: '#1a1a1a', skin: '#8a6040' },
  },
  {
    id: 'garrow',
    name: 'Sir Garrow',
    level: 'ashkeep',
    place: 'keep',
    offset: [10, -0.5],
    greets: 'The keep still stands. So do I. Just.',
    look: { tint: '#8a8a9a', hair: '#5a5a5a', skin: '#d8a888' },
  },
  {
    id: 'esk',
    name: 'Esk the pilgrim',
    level: 'maw',
    place: 'ash',
    offset: [-4.5, -1.5],
    greets:
      'I walked from Mossvale to see the end of the world. It’s very warm.',
    look: { tint: '#e0d8c0', hair: '#6a5a4a', skin: '#a87858' },
    staff: true,
  },
]

export let quests: Quest[] = [
  // Brannagh the forgewife, at the forge in Emberfall.
  {
    id: 'brannagh-slimes',
    giver: 'brannagh',
    goal: 'slay',
    target: 'emberslime',
    count: 6,
    xp: 1580,
    title: 'Slime in the coals',
    body:
      'Ember slimes crawl into my coals and burn them wrong. Six of them, and I will talk to you about blades.',
  },
  {
    id: 'brannagh-backs',
    giver: 'brannagh',
    after: 'brannagh-slimes',
    goal: 'slay',
    target: 'emberback',
    count: 3,
    xp: 1250,
    title: 'Backs of fire',
    body:
      'Emberbacks graze the ash, and they are full of good iron. Three of them. They won’t be happy about it.',
  },
  {
    id: 'brannagh-embers',
    giver: 'brannagh',
    after: 'brannagh-backs',
    goal: 'gather',
    target: 'ember',
    count: 6,
    xp: 800,
    gift: 'blade6',
    title: 'Wyrmfire',
    body:
      'Six ember cores and a little iron, and I will forge you a blade that fire cannot touch. You will need it where you are going.',
  },
  // Ashby the bellows-boy, at the Emberfall bellows.
  {
    id: 'ashby-salamanders',
    giver: 'ashby',
    goal: 'slay',
    target: 'salamander',
    count: 4,
    xp: 1290,
    title: 'Salamanders in the flue',
    body:
      'Salamanders keep crawling up the forge flue to sleep in the heat, and then the whole forge smokes. Four of them, please.',
  },
  {
    id: 'ashby-imps',
    giver: 'ashby',
    after: 'ashby-salamanders',
    goal: 'slay',
    target: 'imp',
    count: 3,
    xp: 1060,
    gift: 'draught',
    title: 'Imps at the bellows',
    body:
      'Cinder imps cut holes in my bellows for a laugh. Three of them, and I’ll pump for you any time.',
  },
  {
    id: 'ashby-flamelings',
    giver: 'ashby',
    after: 'ashby-imps',
    goal: 'slay',
    target: 'flameling',
    count: 3,
    xp: 1160,
    gift: 'tonic',
    title: 'Sparks that walk',
    body:
      'Flamelings come out of the vents north-east of the forge, and they set fire to whatever they touch. Three of them.',
  },
  // Cole the ash-walker, on the ash of Cinderreach.
  {
    id: 'cole-salamanders',
    giver: 'cole',
    goal: 'slay',
    target: 'salamander',
    count: 6,
    xp: 1930,
    title: 'Salamanders in the ash',
    body:
      'Salamanders swim through the ash like fish through water. Six of them, and the road to the keep is open.',
  },
  {
    id: 'cole-imps',
    giver: 'cole',
    after: 'cole-salamanders',
    goal: 'slay',
    target: 'imp',
    count: 6,
    xp: 2120,
    title: 'Cinder imps',
    body:
      'The imps throw cinders at anyone passing, and they laugh while they do it. Six of them.',
  },
  {
    id: 'cole-crags',
    giver: 'cole',
    after: 'cole-imps',
    goal: 'slay',
    target: 'cindercrag',
    count: 3,
    xp: 1350,
    title: 'Rocks that burn',
    body:
      'Cindercrags roll down off the volcano north-west of here, burning as they go. Three of them.',
  },
  {
    id: 'cole-flamelings',
    giver: 'cole',
    after: 'cole-crags',
    goal: 'slay',
    target: 'flameling',
    count: 4,
    xp: 1540,
    gift: 'draught',
    title: 'Fire on legs',
    body:
      'Flamelings dance on the ash where the road runs north. Four of them, and I can walk the reach in peace. Sir Garrow holds the keep up that road, if he still lives.',
  },
  // Sir Garrow, the last knight of Ashkeep.
  {
    id: 'garrow-imps',
    giver: 'garrow',
    goal: 'slay',
    target: 'imp',
    count: 8,
    xp: 2820,
    title: 'The last knight',
    body:
      'I am the last knight of Ashkeep. We held the road to the Maw for a hundred years. Cinder imps hold my walls now. Eight of them.',
  },
  {
    id: 'garrow-wardens',
    giver: 'garrow',
    after: 'garrow-imps',
    goal: 'slay',
    target: 'warden',
    count: 2,
    xp: 1840,
    title: 'My own wardens',
    body:
      'The keep’s own wardens, my brothers once, walk the walls with briar in their armour. Two of them. They would thank you.',
  },
  {
    id: 'garrow-backs',
    giver: 'garrow',
    after: 'garrow-wardens',
    goal: 'slay',
    target: 'emberback',
    count: 4,
    xp: 1670,
    gift: 'elixir',
    title: 'At the gate',
    body:
      'Emberbacks crowd the ruined gate south-east of the keep, where the road ran to the Maw. Four of them.',
  },
  {
    id: 'garrow-wyrm',
    giver: 'garrow',
    after: 'garrow-backs',
    level: 'maw',
    goal: 'slay',
    target: 'cinderwyrm',
    count: 1,
    xp: 2080,
    gift: 'elixir',
    title: 'The Cinder Wyrm',
    body:
      'Under the Maw lies the root of the briar, and on the root lies the Cinder Wyrm, crowned in thorns. Every briar in the world grows from what it guards. Take the road back through Cinderreach and on to the Maw. End it, and then go home: Wren will want to know.',
  },
  // Esk the pilgrim, at the edge of the Maw.
  {
    id: 'esk-backs',
    giver: 'esk',
    goal: 'slay',
    target: 'emberback',
    count: 4,
    xp: 1670,
    title: 'The last mile',
    body:
      'I walked from Mossvale to see the Maw with my own eyes. Emberbacks block the last mile. Four of them, and I’ll walk it with you.',
  },
  {
    id: 'esk-flamelings',
    giver: 'esk',
    after: 'esk-backs',
    goal: 'slay',
    target: 'flameling',
    count: 4,
    xp: 1540,
    title: 'Dancers on the rim',
    body:
      'Flamelings dance on the rim of the Maw, and they push pilgrims in. Four of them.',
  },
  {
    id: 'esk-crags',
    giver: 'esk',
    after: 'esk-flamelings',
    goal: 'slay',
    target: 'cindercrag',
    count: 4,
    xp: 1800,
    gift: 'elixir',
    title: 'The cone',
    body:
      'Cindercrags roll down the cone south-west of here all day long. Four of them, and I’ll sit down and look at the end of the world in peace.',
  },
]
