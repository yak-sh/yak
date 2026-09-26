// The kinds of place of the coast, and each of its levels' own: Gullwick's
// harbour bay and the fields above it; Driftwood's strand, dunes and shore
// pines; Saltreach's salt pans, tide line and white bluffs; Shellstrand's
// shell isles and sea pinks; Stormhead's surf, its wind-bent moor and the
// light on its head.
import { fbm, lerp, smooth } from '../rand.ts'
import { HILLS } from './hills.ts'
import { bump, crest, type Feature, Top, wide } from './kit.ts'
import { VALE } from './vale.ts'

let { crags, meadow, woods } = VALE
let { moor } = HILLS

// The sea, and a beach of sand and dune grass down to it.
let coast: Feature = {
  shape: (h, d, x, z, s) =>
    h - bump(d, 30) * (6.5 + fbm(x / 9, z / 9, 51 + s) * 2),
  hold: (d) => bump(d, 34),
  cover: (n) => n > 0.62 ? Top.dry : Top.sand,
  trees: 0.1,
  rocks: 0.06,
  grows: ['palm'],
  decor: [['tuft', 0.02]],
}
// Shallow sea broken into islets.
let isles: Feature = {
  shape: (h, d, x, z, s) =>
    lerp(h, 2.2 + fbm(x / 7, z / 7, 53 + s) * 5.2, smooth(60, 30, d)),
  hold: wide,
  cover: (n) => n > 0.5 ? Top.grass : Top.sand,
  trees: 0.1,
  rocks: 0.08,
  grows: ['palm'],
  decor: [['tuft', 0.03], ['flower', 0.01]],
}
// Low crags of Stormhead, bare but for trees the wind has bent.
let headland: Feature = {
  ...crags,
  like: 'crags',
  trees: 0,
  rocks: 0.4,
  grows: ['windtree'],
  decor: [['tuft', 0.05]],
}

export let COAST: Record<string, Feature> = {
  coast,
  isles,
  // Gullwick's bay: a shingle shore, the stone quay out into the harbour
  // with boats tied along it, and fish racks above the tide.
  bay: {
    ...coast,
    like: 'coast',
    cover: (n) => n > 0.7 ? Top.dry : Top.sand,
    trees: 0.02,
    grows: ['pine'],
    decor: [['wrack', 0.02], ['tuft', 0.02]],
    strewn: true,
    builds: [
      { kind: 'quay', x: 0, z: 37, seed: 0 },
      { kind: 'netrack', x: -8, z: 40, seed: 0 },
      { kind: 'netrack', x: 7.5, z: 41, seed: 1 },
    ],
  },
  // Gullwick's fields above the harbour: furrows, cabbages and barley, and a
  // scarecrow minding them.
  farmland: {
    ...meadow,
    like: 'meadow',
    cover: (_, d, __, z) =>
      d < 26 ? Math.floor(z / 1.5) & 1 ? Top.mud : Top.lush : undefined,
    trees: -0.1,
    decor: [['cabbage', 0.1], ['barley', 0.07]],
    builds: [{ kind: 'scarecrow', x: 2, z: -3, seed: 0 }],
  },
  // Driftwood's strand: a wide pale beach piled with bleached logs, and a
  // wreck at the tide.
  strand: {
    ...coast,
    like: 'coast',
    hold: (d) => bump(d, 38),
    cover: (n, d) => n > 0.75 && d > 26 ? Top.dry : Top.sand,
    trees: -0.1,
    rocks: 0.3,
    grows: ['shorepine'],
    stones: ['driftlog'],
    decor: [['wrack', 0.03], ['marram', 0.02]],
    strewn: true,
    builds: [{ kind: 'wreck', x: 35, z: 0, seed: 0 }],
  },
  // Dunes of marram behind the strand.
  marram: {
    shape: (h, d, x, z, s) =>
      lerp(h, 6.8, bump(d, 30) * 0.7) +
      bump(d, 30) * crest(fbm(x / 7, z / 11, 61 + s)) * 2.5,
    hold: (d) => bump(d, 30),
    like: 'meadow',
    cover: (n) => n > 0.5 ? Top.sand : Top.dry,
    trees: -0.03,
    rocks: 0.05,
    stones: ['driftlog'],
    decor: [['marram', 0.14], ['tuft', 0.02]],
    strewn: true,
  },
  // Shore pines on the sand, twisted and flat-crowned.
  shorewood: {
    ...woods,
    like: 'woods',
    cover: (n) => n > 0.6 ? Top.sand : Top.dry,
    trees: 0.4,
    rocks: 0.1,
    grows: ['shorepine'],
    stones: ['driftlog'],
    decor: [['marram', 0.04], ['tuft', 0.03]],
    strewn: true,
  },
  // Saltreach's salt pans: flat white ground to the hills, brine standing
  // in the lowest of it, salt raked into heaps, and the saltworks.
  saltflat: {
    shape: (h, d, x, z, s) =>
      lerp(
        h,
        5.6 - smooth(0.46, 0.41, fbm(x / 9, z / 9, 71 + s)) * 1.2,
        smooth(58, 36, d),
      ),
    hold: wide,
    like: 'moor',
    cover: (n) => n > 0.85 ? Top.dry : Top.sand,
    trees: -0.2,
    rocks: 0.1,
    stones: ['saltpile'],
    decor: [['saltcrust', 0.1]],
    strewn: true,
    builds: [{ kind: 'saltworks', x: 12, z: 10, seed: 0 }],
  },
  // The tide line: wet flats running far out to the sea, and the weed it
  // throws up along them.
  tideline: {
    shape: (h, d, x, z, s) =>
      lerp(h, 3.2 + d * 0.05 + fbm(x / 6, z / 6, 75 + s) * 0.4, bump(d, 42)),
    hold: (d) => bump(d, 40),
    like: 'coast',
    cover: () => Top.sand,
    shore: Top.mud,
    trees: -0.2,
    rocks: -0.05,
    decor: [['wrack', 0.025], ['shell', 0.01]],
    strewn: true,
  },
  // Low white bluffs over the pans.
  bluffs: {
    ...crags,
    like: 'crags',
    shape: (h, d, x, z, s) =>
      h + bump(d, 22) * (1 + fbm(x / 8, z / 8, 73 + s) * 6),
    cover: (n) => n > 0.45 ? Top.stone : Top.dry,
    trees: -0.2,
    rocks: 0.3,
    stones: ['chalk'],
    decor: [['tuft', 0.03]],
  },
  // Shellstrand's isles: pink shell sand between islets in a clear lagoon,
  // sea pinks on the turf, and the great conch.
  shellisles: {
    ...isles,
    like: 'isles',
    cover: (n) => n > 0.55 ? Top.grass : Top.sand,
    trees: -0.3,
    rocks: 0.05,
    grows: ['pine'],
    decor: [['shell', 0.05], ['thrift', 0.03]],
    strewn: true,
    builds: [{ kind: 'conch', x: -9, z: 4, seed: 0 }],
  },
  // Shellstrand's beach, strewn with shells.
  shellbeach: {
    ...coast,
    like: 'coast',
    cover: () => Top.sand,
    trees: -0.3,
    grows: ['pine'],
    decor: [['shell', 0.06], ['thrift', 0.01]],
    strewn: true,
  },
  // Turf thick with sea pinks.
  thrift: {
    ...meadow,
    like: 'meadow',
    decor: [['thrift', 0.1], ['tuft', 0.03]],
  },
  // Stormhead's shore: dark sand, black rocks, weed the storms threw up.
  surf: {
    ...coast,
    like: 'coast',
    cover: (n) => n > 0.6 ? Top.stone : Top.sand,
    trees: -0.1,
    rocks: 0.35,
    grows: ['windtree'],
    stones: ['rock'],
    decor: [['wrack', 0.04]],
    strewn: true,
  },
  // Stormhead's moor: heath, and trees bent flat by the wind.
  windmoor: {
    ...moor,
    like: 'moor',
    trees: 0.06,
    grows: ['windtree'],
    stones: ['rock'],
    decor: [['heather', 0.05], ['tuft', 0.05]],
    builds: undefined,
  },
  headland,
  // The head, and the lighthouse on it.
  beacon: {
    ...headland,
    builds: [{ kind: 'lighthouse', x: 0, z: 0, seed: 0 }],
  },
}
