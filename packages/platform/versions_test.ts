import { equal, test } from '@yaks/testing'
import { backTo, type Switch, type Version } from './versions.ts'

// Versions by number, newest first, each its own files; and the pointer's
// moves, each from one number to another at a moment.
let kept = (...numbers: number[]): Version[] =>
  numbers.sort((a, b) => b - a).map((version) => ({
    eid: `v${version}`,
    version,
    at: '',
    files: { 'index.html': String(version) },
    worker: '',
  }))
let moved = (...pairs: [number | null, number][]): Switch[] =>
  pairs.map(([from, to], i) => ({
    switched: {
      from: from == null ? null : `v${from}`,
      to: `v${to}`,
      at: String(i),
    },
  }))
let back = (all: Version[], moves: Switch[], now: number, asked?: number) =>
  backTo(all, moves, now, asked)?.version

test('putting an app back selects what was live before this went out', () => {
  let all = kept(1, 2, 3)
  // v3 went out over v2.
  equal(back(all, moved([null, 1], [1, 2], [2, 3]), 3), 2)
  // Rolled back to v1, then v3 deployed over it: back is v1, not v2.
  equal(back(all, moved([null, 1], [1, 2], [2, 1], [1, 3]), 3), 1)
  // Rolled back to v1 and forward to v3 again: its own deploy's move counts.
  equal(back(all, moved([null, 1], [1, 2], [2, 3], [3, 1], [1, 3]), 3), 2)
  // With no move on record, the next number down.
  equal(back(all, [], 3), 2)
  equal(back(all, [], 1), undefined)
})

test('a version asked for by number is selected, newer ones included', () => {
  let all = kept(1, 2, 3)
  equal(back(all, [], 1, 3), 3)
  equal(back(all, [], 3, 9), undefined)
})
