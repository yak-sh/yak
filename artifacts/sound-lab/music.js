export let tracks = [
  { id: 'kick', name: 'Kick', color: '#ed713e', key: '1', melodic: false },
  { id: 'snare', name: 'Snare', color: '#f4a552', key: '2', melodic: false },
  { id: 'hat', name: 'Closed hat', color: '#e5c965', key: '3', melodic: false },
  { id: 'open', name: 'Open hat', color: '#a4b66f', key: '4', melodic: false },
  { id: 'clap', name: 'Clap', color: '#72b5a4', key: '5', melodic: false },
  {
    id: 'perc',
    name: 'Percussion',
    color: '#72a5bd',
    key: '6',
    melodic: false,
  },
  { id: 'bass', name: 'Bass', color: '#9c94ba', key: '7', melodic: true },
  { id: 'keys', name: 'Keys', color: '#c78da3', key: '8', melodic: true },
]

export let presets = [
  { id: 'night-shift', name: 'Night shift', bpm: 112, swing: 0.12, root: 38 },
  { id: 'soft-circuit', name: 'Soft circuit', bpm: 88, swing: 0.42, root: 41 },
  { id: 'metro', name: 'Metro', bpm: 128, swing: 0.04, root: 36 },
  { id: 'blank', name: 'Blank tape', bpm: 110, swing: 0, root: 38 },
]

export let clamp = (value, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value))
export let frequency = (note) => 440 * 2 ** ((note - 69) / 12)
export let noteName = (note) =>
  ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][
    ((note % 12) + 12) % 12
  ] + (Math.floor(note / 12) - 1)
/** @returns {{length: number, steps: ({velocity: number, note?: number} | null)[][]}} */
export let blank = (length = 32) => ({
  length,
  steps: tracks.map(() => Array.from({ length: 32 }, () => null)),
})

let fill = (pattern, track, steps, note, velocity = 0.8) =>
  steps.forEach((step, i) => {
    pattern.steps[track][step] = {
      velocity: velocity * (i % 2 ? 0.82 : 1),
      ...(note === undefined
        ? {}
        : { note: Array.isArray(note) ? note[i % note.length] : note }),
    }
  })

let pattern = (preset, bank) => {
  let value = blank()
  if (preset.id === 'blank') return value
  let metro = preset.id === 'metro'
  let soft = preset.id === 'soft-circuit'
  let root = preset.root + [0, 0, 5, 3][bank]
  fill(
    value,
    0,
    metro ? [0, 4, 8, 12, 16, 20, 24, 28] : [0, 6, 10, 16, 22, 26, 30],
  )
  fill(value, 1, [4, 12, 20, 28], undefined, soft ? 0.55 : 0.72)
  fill(
    value,
    2,
    Array.from({ length: 16 }, (_, i) => i * 2),
    undefined,
    soft ? 0.35 : 0.46,
  )
  fill(
    value,
    3,
    metro ? [2, 6, 10, 14, 18, 22, 26, 30] : [14, 30],
    undefined,
    0.38,
  )
  fill(value, 4, [12, 28], undefined, 0.42)
  fill(value, 5, [3, 11, 19, 23, 27], [root + 24, root + 31], 0.35)
  fill(value, 6, [0, 6, 10, 14, 16, 22, 26, 30], [
    root,
    root,
    root + 7,
    root + 10,
  ], 0.72)
  fill(value, 7, soft ? [0, 10, 16, 26] : [2, 10, 18, 26], [
    root + 24,
    root + 27,
    root + 31,
    root + 34,
  ], 0.45)
  if (bank % 2) {
    fill(value, 1, [27, 30, 31], undefined, 0.4)
    fill(value, 2, [13, 15, 29, 31], undefined, 0.28)
  }
  return value
}

export let song = (id = presets[0].id) => {
  let preset = presets.find((value) => value.id === id) || presets[0]
  return {
    title: preset.name,
    bpm: preset.bpm,
    swing: preset.swing,
    master: 0.8,
    delay: 0.15,
    pattern: 0,
    mode: 'pattern',
    chain: [0, 0, 1, 1, 2, 2, 3, 3],
    patterns: Array.from({ length: 4 }, (_, bank) => pattern(preset, bank)),
    mix: tracks.map((track, index) => ({
      volume: index < 2 ? 0.82 : 0.65,
      pan: [0, 0, -0.2, 0.22, 0.06, -0.3, 0, 0.25][index],
      tone: track.id === 'bass' ? 0.42 : 0.7,
      mute: false,
      solo: false,
    })),
  }
}

export let audible = (mix, index) =>
  !mix[index].mute && (!mix.some((track) => track.solo) || mix[index].solo)

export let stepDuration = (song, step) =>
  60 / clamp(song.bpm, 40, 240) / 4 *
  (1 + (step % 2 ? -1 : 1) * clamp(song.swing) * 0.65)

export let position = (song, cursor) => ({
  ...cursor,
  pattern: song.mode === 'chain'
    ? song.chain[cursor.chain % song.chain.length]
    : song.pattern,
})

export let advance = (song, cursor) => {
  let current = position(song, cursor)
  let step = current.step + 1
  let end = step >= song.patterns[current.pattern].length
  return position(song, {
    pattern: current.pattern,
    chain: end && song.mode === 'chain'
      ? (cursor.chain + 1) % song.chain.length
      : cursor.chain,
    step: end ? 0 : step,
    time: cursor.time + stepDuration(song, current.step),
  })
}

export let sequence = (
  song,
  { mode = song.mode, pattern = song.pattern } = {},
) => {
  let banks = mode === 'chain' ? song.chain : [pattern]
  let time = 0
  return banks.flatMap((bank, chain) =>
    Array.from({ length: song.patterns[bank].length }, (_, step) => {
      let event = { pattern: bank, chain, step, time }
      time += stepDuration(song, step)
      return event
    })
  )
}

export let duration = (song, options) => {
  let events = sequence(song, options)
  let last = events.at(-1)
  return last ? last.time + stepDuration(song, last.step) : 0
}
