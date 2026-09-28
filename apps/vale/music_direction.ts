// Each land's music follows its terrain and mood. New songs read this authored
// direction; recorded prompts and the tracks already playing are provenance.
export type Direction = {
  setting: string
  instruments: string
  voice: 'none' | 'solo' | 'choir'
  themes: [string, string]
}

export let DIRECTIONS: Record<string, Direction> = {
  mossvale: {
    setting:
      'a welcoming green valley, lakeside village and warm morning light',
    instruments: 'fiddle, wooden flute, harp and light hand drum',
    voice: 'none',
    themes: ['a generous village welcome', 'a quiet return along the lake'],
  },
  birchmere: {
    setting: 'silver birches around a peaceful mere and bright fields',
    instruments: 'rippling harp, wooden flute and light violins',
    voice: 'none',
    themes: [
      'a fresh, hopeful waterside melody',
      'a gentle reflection among birches',
    ],
  },
  clovermead: {
    setting: 'sunny clover meadows, a little pond and golden copses',
    instruments: 'dancing fiddle, plucked harp and small frame drum',
    voice: 'none',
    themes: [
      'a playful meadow dance',
      'an unhurried tune in the afternoon sun',
    ],
  },
  fernwood: {
    setting: 'a hidden hamlet in deep ferns beneath green-filtered light',
    instruments: 'low wooden flute, muted fiddle and soft harp',
    voice: 'none',
    themes: [
      'an intimate, winding woodland melody',
      'a curious tune near the fern heart',
    ],
  },
  elderglade: {
    setting: 'ancient elder trees, a still pool and amber motes',
    instruments: 'harp harmonics, breathy flute and sustained violas',
    voice: 'solo',
    themes: [
      'a reverent melody beneath old branches',
      'a luminous, gentle answer by the pool',
    ],
  },
  greypine: {
    setting: 'high grey pines, a cold tarn and a watch crag in mist',
    instruments: 'alto flute, low cello and spare bowed strings',
    voice: 'none',
    themes: [
      'a searching phrase across the tarn',
      'a cool, spacious watch melody',
    ],
  },
  wolfden: {
    setting: 'a dark pine hollow, wolf lair and black tarn at dusk',
    instruments: 'low cello, bass flute and restrained frame drum',
    voice: 'none',
    themes: [
      'a wary, brave melody through the hollow',
      'a guarded theme that finds resolve',
    ],
  },
  gullwick: {
    setting: 'a busy fishing harbour, blue bay and farmland in fresh sea air',
    instruments: 'fiddle, concertina, wooden flute and light hand drum',
    voice: 'none',
    themes: ['a lively, welcoming harbour melody', 'a warm homeward tide tune'],
  },
  driftwood: {
    setting: 'a wild strand, weathered wharf and dune grass under grey skies',
    instruments: 'low fiddle, plucked guitar and airy wooden flute',
    voice: 'none',
    themes: [
      'a wide, weathered shore melody',
      'a wistful tune that endures the salt wind',
    ],
  },
  saltreach: {
    setting: 'white salt flats, tidal edge and pale bluffs in warm mist',
    instruments: 'sparse harp, bowed glass and soft viola',
    voice: 'none',
    themes: [
      'an open, shimmering salt-flat melody',
      'a reflective tune at the distant tide',
    ],
  },
  shellstrand: {
    setting: 'pink shell beaches and green isles in clear turquoise shallows',
    instruments: 'plucked harp, bright wooden flute and light fiddle',
    voice: 'none',
    themes: [
      'a lilting island melody',
      'a calm refrain shaped like the ebbing tide',
    ],
  },
  stormhead: {
    setting:
      'rain-lashed headland, dark surf and a lone beacon on slate cliffs',
    instruments: 'low strings, sea-worn horn and measured frame drum',
    voice: 'none',
    themes: [
      'a bold melody against the gale',
      'a watchful theme opening toward the beacon',
    ],
  },
  reedmarsh: {
    setting: 'golden reeds, mirror pools and a stilt village in warm mist',
    instruments: 'reed flute, pizzicato fiddle and soft hand percussion',
    voice: 'none',
    themes: ['a buoyant tune through the reeds', 'a patient waterborne melody'],
  },
  mirewood: {
    setting: 'drowned trees and dark pools under a green firefly haze',
    instruments: 'low cello, bass flute and isolated harp notes',
    voice: 'none',
    themes: [
      'a low, searching melody',
      'a slow tune with glimmers in the mire',
    ],
  },
  fenhollow: {
    setting: 'peat fen, pale pools and an old dig beneath a soft grey sky',
    instruments: 'warm viola, low wooden flute and plucked strings',
    voice: 'none',
    themes: [
      'a curious, measured excavation theme',
      'a quiet echo of buried history',
    ],
  },
  sunkenkirk: {
    setting: 'a half-drowned stone kirk and churchyard among cold pools',
    instruments: 'solemn cello, distant handbells and soft flute',
    voice: 'none',
    themes: [
      'a graceful memorial melody',
      'a mournful theme slowly finding light',
    ],
  },
  bogheart: {
    setting: 'deep brown bog pools and a toadstool wood under yellow-grey sky',
    instruments: 'bass flute, dark cello and dry hand drum',
    voice: 'none',
    themes: [
      'a wary, earthy wandering melody',
      'an uncanny tune that keeps its warmth',
    ],
  },
  sporefen: {
    setting: 'a luminous fungal marsh and tall toadstools over green water',
    instruments: 'wooden flute, plucked harp and soft mallet percussion',
    voice: 'none',
    themes: ['a curious, buoyant melody', 'a softly enchanted drifting theme'],
  },
  stonestep: {
    setting: 'a quarry town, pale stone steps, green meadow and watchful moor',
    instruments: 'sturdy fiddle, wooden flute and hand drum',
    voice: 'none',
    themes: [
      'a welcoming hill-country melody',
      'a broad tune climbing the quarry steps',
    ],
  },
  heatherfell: {
    setting: 'violet heather moor, scree and a small high tarn',
    instruments: 'high flute, open fiddle and unhurried frame drum',
    voice: 'none',
    themes: ['an airy roaming melody', 'a wistful hillside refrain'],
  },
  oldwall: {
    setting: 'broken ancient walls in bracken and autumn woods',
    instruments: 'amber cello, harp and autumnal wooden flute',
    voice: 'none',
    themes: [
      'a nostalgic melody by the old stones',
      'a dignified theme of a forgotten kingdom',
    ],
  },
  kingsbarrow: {
    setting: 'a royal barrow and timber hall on a shadowed moor',
    instruments: 'low strings, ancient horn and measured hand drum',
    voice: 'solo',
    themes: [
      'a noble but weathered hall melody',
      'a quiet memorial for the buried king',
    ],
  },
  giantsteps: {
    setting:
      'a monumental basalt stair across grey crags and lonely stonefield',
    instruments: 'resonant cello, deep drum and distant horn',
    voice: 'none',
    themes: [
      'a broad melody climbing the stair',
      'a spacious theme from the summit',
    ],
  },
  glowcap: {
    setting: 'a blue-dusk village under immense glowing mushrooms',
    instruments: 'celesta, soft harp and wooden flute',
    voice: 'none',
    themes: [
      'a gentle wonder-filled melody',
      'a playful nocturnal village tune',
    ],
  },
  gleamdeep: {
    setting: 'violet mushroom woods, amethyst stone and shining pools',
    instruments: 'harp, glass chimes and delicate bowed strings',
    voice: 'none',
    themes: [
      'a luminous winding melody',
      'a serene theme reflected in crystal water',
    ],
  },
  shardvault: {
    setting: 'a pale crystal vault among cold shards and blue-white water',
    instruments: 'glassy chimes, low strings and fragile flute',
    voice: 'none',
    themes: [
      'a precise, mysterious vault melody',
      'an expansive theme in the cold light',
    ],
  },
  dustmere: {
    setting: 'a dry vanished lake, old shoreline and last well in dusty air',
    instruments: 'plucked lute, low wooden flute and dry hand drum',
    voice: 'none',
    themes: ['a spare, resilient travel melody', 'a wistful memory of water'],
  },
  palmwell: {
    setting: 'a palm oasis and caravan camp among golden dunes',
    instruments: 'oud, reed flute and lively hand percussion',
    voice: 'none',
    themes: [
      'a warm caravan traveling melody',
      'a restful tune in green shade by water',
    ],
  },
  sunscar: {
    setting: 'white-hot dunes, buried ruins, bones and a dark scar in sand',
    instruments: 'low bowed strings, reed flute and restrained frame drum',
    voice: 'none',
    themes: [
      'a tense, wide-open crossing theme',
      'a searching melody rising above the dunes',
    ],
  },
  redmesa: {
    setting: 'red sandstone buttes, clay slopes and a spring at copper sunset',
    instruments: 'cello, plucked lute and open wooden flute',
    voice: 'none',
    themes: [
      'a spacious red-rock melody',
      'a warm, wandering tune toward the spring',
    ],
  },
  tombsands: {
    setting: 'dusk over a sand-buried necropolis, sunken tombs and pale cliffs',
    instruments: 'deep bowed strings, sparse bronze bells and slow frame drum',
    voice: 'choir',
    themes: [
      'an ancient theme gathering grandeur as the lost city appears',
      'a solemn melody settling into peace among the tombs',
    ],
  },
  frostmoor: {
    setting: 'a scoured snowy moor, stunted pines and dark tarn in wind',
    instruments: 'cold high flute, low cello and spare chimes',
    voice: 'none',
    themes: [
      'a wind-bitten crossing melody',
      'a brave, measured theme in the cold',
    ],
  },
  rimeholt: {
    setting: 'a sheltering holt among frost-coated trees and a glacier',
    instruments: 'warm fiddle, wooden flute and quiet harp',
    voice: 'none',
    themes: ['a cozy winter refuge melody', 'a hushed, crystalline snow theme'],
  },
  frostpine: {
    setting: 'deep snow-covered spruce and a remote logger camp',
    instruments: 'low fiddle, breathy flute and soft drum',
    voice: 'none',
    themes: ['a dark, steady woodland tune', 'a hushed snowfall melody'],
  },
  icefall: {
    setting: 'a blue glacier fall, deep crevasses and a cold tarn',
    instruments: 'high strings, icy chimes and pulsing cello',
    voice: 'none',
    themes: [
      'a cascading, clear melody',
      'a cautious crossing tune above the ice',
    ],
  },
  whitepeak: {
    setting: 'an immense white summit above snowfields in thin air',
    instruments: 'soaring strings, simple wooden flute and sparse harp',
    voice: 'none',
    themes: [
      'an open melody reaching the summit',
      'a still, majestic theme in clear air',
    ],
  },
  emberfall: {
    setting: 'a forge town below falling embers and lava cliffs',
    instruments: 'anvil strikes, low fiddle, cello and hand drum',
    voice: 'none',
    themes: [
      'a determined forge melody',
      'a warm but uneasy tune beside the fires',
    ],
  },
  cinderreach: {
    setting: 'black ash flats, volcanic vents and a dim ash-filled sky',
    instruments: 'low cello, dark horn and restrained drum',
    voice: 'choir',
    themes: [
      'a weathered journey through stillness and heat',
      'a stark melody gathering strength toward calm',
    ],
  },
  ashkeep: {
    setting: 'a lonely grey keep and gate in a cold ashfield',
    instruments: 'muted strings, cello and solitary horn',
    voice: 'none',
    themes: ['a noble, weary melody', 'a humane last-watch theme'],
  },
  maw: {
    setting: 'an immense fiery chasm at the scorched edge of the world',
    instruments: 'deep strings, low brass and measured war drums',
    voice: 'none',
    themes: [
      'a grave heroic finale',
      'a dark climb toward a hard-won hopeful ending',
    ],
  },
}
