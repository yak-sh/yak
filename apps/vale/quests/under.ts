// The people under the old woods, down the Elder Heart’s roots: Glowcap
// Hollow and Sporefen among the giant toadstools, then the crystal of
// Gleamdeep and the Shardvault, where the last king went looking.
import type { Giver, Quest } from '../quests.ts'

export let givers: Giver[] = [
  {
    id: 'morel',
    name: 'Capwife Morel',
    level: 'glowcap',
    place: 'hollow',
    offset: [-6.5, -1],
    greets: 'Welcome under. Duck your head; the caps are low.',
    look: { tint: '#a04a3a', hair: '#f0e0c0', skin: '#e8c8a8' },
  },
  {
    id: 'nib',
    name: 'Nib the lamplighter',
    level: 'glowcap',
    place: 'hollow',
    offset: [-2.5, 6.5],
    greets: 'It’s always dusk down here. That’s why they need me.',
    look: { tint: '#6a5aa0', hair: '#f0c060', skin: '#f0d0b8' },
  },
  {
    id: 'puff',
    name: 'Puffball the spore-picker',
    level: 'sporefen',
    place: 'toadstools',
    offset: [-7.5, -4],
    greets: 'Don’t sneeze. Please don’t sneeze.',
    look: { tint: '#c0a0c0', hair: '#6a4a6a', skin: '#f0d0c0' },
  },
  {
    id: 'dunstan',
    name: 'Dunstan the miner',
    level: 'gleamdeep',
    place: 'toadstools',
    offset: [-9, 23.5],
    greets: 'Crystal sings if you tap it right. Most folk tap it wrong.',
    look: { tint: '#5a5a6a', hair: '#2a2a2a', skin: '#c09070' },
  },
  {
    id: 'ondine',
    name: 'Ondine the seer',
    level: 'shardvault',
    place: 'toadstools',
    offset: [-20, 22.5],
    greets: 'I see the crystal, and the crystal sees me.',
    look: { tint: '#3a3a7a', hair: '#f0f0ff', skin: '#a07860' },
    staff: true,
  },
]

export let quests: Quest[] = [
  // Capwife Morel, of Glowcap Hollow.
  {
    id: 'morel-bogslimes',
    giver: 'morel',
    goal: 'slay',
    target: 'bogslime',
    count: 6,
    xp: 510,
    title: 'Slime in the hollow',
    body:
      'Welcome under. Bog slimes slide down here from the pools and smother the young caps. Six of them.',
  },
  {
    id: 'morel-brutes',
    giver: 'morel',
    after: 'morel-bogslimes',
    goal: 'slay',
    target: 'stoolbrute',
    count: 2,
    xp: 370,
    title: 'Brutes on the paths',
    body:
      'Toadstool brutes sit down across the paths and won’t get up for anyone. Two of them. Move them.',
  },
  {
    id: 'morel-sporelings',
    giver: 'morel',
    after: 'morel-brutes',
    goal: 'slay',
    target: 'sporeling',
    count: 4,
    xp: 820,
    gift: 'draught',
    title: 'Bad spores',
    body:
      'Sporelings drift through the hollow, and where their spores land, briar grows instead of caps. Burst four. Then take the road west, into the crystal: Dunstan at Gleamdeep will show you the way down.',
  },
  // Nib the lamplighter, who lights the lamps of Glowcap Hollow.
  {
    id: 'nib-glow',
    giver: 'nib',
    goal: 'gather',
    target: 'glow',
    count: 3,
    xp: 630,
    title: 'Wisplight for the lamps',
    body:
      'The hollow’s lamps burn wisplight, and I’m nearly out. The glimmers and lanterns carry it. Three lights, and nobody trips in the dark.',
  },
  {
    id: 'nib-caps',
    giver: 'nib',
    after: 'nib-glow',
    goal: 'gather',
    target: 'cap',
    count: 3,
    xp: 700,
    gift: 'tonic',
    title: 'Shades for the lamps',
    body:
      'Mushroom caps make the best lamp shades: soft light, no glare. The toadstool brutes grow them on their backs. Three, please.',
  },
  // Puffball the spore-picker, among the toadstools of Sporefen.
  {
    id: 'puff-brutes',
    giver: 'puff',
    goal: 'slay',
    target: 'stoolbrute',
    count: 3,
    xp: 560,
    title: 'The big stools',
    body:
      'Toadstool brutes have sat down across the picking paths, and they won’t move for anyone. Three of them. Move them.',
  },
  {
    id: 'puff-sporelings',
    giver: 'puff',
    after: 'puff-brutes',
    goal: 'slay',
    target: 'sporeling',
    count: 4,
    xp: 820,
    title: 'Don’t breathe in',
    body:
      'Sporelings float over the fen, and one good sneeze near them grows a thorn in your nose. Four of them, and hold your breath.',
  },
  {
    id: 'puff-trolls',
    giver: 'puff',
    after: 'puff-sporelings',
    goal: 'slay',
    target: 'troll',
    count: 2,
    xp: 1030,
    title: 'Trolls in the fen',
    body:
      'Mire trolls wade up out of the fen and eat the good caps, stalk and all. Two of them, and the picking can go on.',
  },
  {
    id: 'puff-mudjaw',
    giver: 'puff',
    after: 'puff-trolls',
    goal: 'slay',
    target: 'mudjaw',
    count: 1,
    xp: 1160,
    gift: 'draught',
    title: 'A toad on the path',
    body:
      'Old Mudjaw has come up the fen from Bogheart, and he sits on the path like he owns it. He doesn’t. Shift him.',
  },
  // Dunstan the miner, at the edge of the Gleamdeep crystal.
  {
    id: 'dunstan-shards',
    giver: 'dunstan',
    goal: 'gather',
    target: 'shard',
    count: 6,
    xp: 1540,
    title: 'A ring of shards',
    body:
      'The Greenkeepers cut their rings from this very crystal. If the wards need mending, they’ll need shards, and I can’t cut a thing with the crystal walking about. Six of them, off whatever has them.',
  },
  {
    id: 'dunstan-glimmerbacks',
    giver: 'dunstan',
    after: 'dunstan-shards',
    goal: 'slay',
    target: 'glimmerback',
    count: 4,
    xp: 820,
    title: 'Crystal that grazes',
    body:
      'Glimmerbacks graze the crystal down to stubs, and now they bite. Four of them, and I can work the gleam again.',
  },
  {
    id: 'dunstan-shardlings',
    giver: 'dunstan',
    after: 'dunstan-glimmerbacks',
    goal: 'slay',
    target: 'shardling',
    count: 6,
    xp: 1580,
    gift: 'draught',
    title: 'Crystal that crawls',
    body:
      'Worse: the crystal itself has started crawling about on legs. Shardlings, with briar in the facets. Six of them. And if you go on north into the Shardvault, look for the old king.',
  },
  // Ondine the seer, at the door of the Shardvault.
  {
    id: 'ondine-shardlings',
    giver: 'ondine',
    goal: 'slay',
    target: 'shardling',
    count: 10,
    xp: 2630,
    title: 'The vault wakes',
    body:
      'The vault is waking, shardling by shardling, and every one has a thorn at its heart. Ten of them, and the vault will be still enough to enter.',
  },
  {
    id: 'ondine-king',
    giver: 'ondine',
    after: 'ondine-shardlings',
    goal: 'slay',
    target: 'hollowking',
    count: 1,
    xp: 1540,
    gift: 'elixir',
    title: 'The Hollow King',
    body:
      'The last Greenkeeper king came down here long ago to cut the briar’s root out of the crystal. The briar found him first. Now he is hollow, and he walks the vault. Let him rest.',
  },
  {
    id: 'ondine-heart',
    giver: 'ondine',
    after: 'ondine-king',
    goal: 'gather',
    target: 'gem',
    count: 1,
    xp: 800,
    gift: 'blade5',
    title: 'The king’s heart',
    body:
      'He carried a hollow heart of crystal, and it is still warm. Give it to me, and take this spear in its place. He would want it used. The road east goes up into the ice.',
  },
]
