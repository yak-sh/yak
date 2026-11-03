// The slideshow without a page: which slides a show holds and in what order,
// moving one, what plays next, and how large a photo is sent.

export let EVERYTHING = '(.show|.slide)&?doc&.limit=5000'

export let LAYOUTS = [
  ['photo', 'The words over the photo'],
  ['side', 'The photo beside the words'],
  ['words', 'Words only'],
]

export let LOOKS = [
  ['warm', 'Warm: cream and brown'],
  ['night', 'Night: dark, for a screen in a dim room'],
  ['paper', 'Paper: white and blue'],
]

export let PACES = [
  [5, '5 seconds'],
  [8, '8 seconds'],
  [12, '12 seconds'],
  [20, '20 seconds'],
  [0, 'Move on by hand'],
]

/** Rows of one answer, sorted under their own component. */
export let split = (rows) => ({
  shows: rows.filter((r) => r.show).sort((a, b) =>
    (a.doc?.title ?? '').localeCompare(b.doc?.title ?? '')
  ),
  slides: rows.filter((r) => r.slide),
})

/** The slides of one show, in playing order. */
export let ordered = (slides, show) =>
  slides.filter((s) => s.slide.show == show).sort((a, b) =>
    (a.slide.ord ?? 0) - (b.slide.ord ?? 0)
  )

/** The place after the last slide. */
export let nextOrd = (slides) =>
  slides.reduce((top, s) => Math.max(top, s.slide.ord ?? 0), 0) + 1

/** The patches that swap a slide with its neighbour; none at either end. */
export let move = (slides, eid, by) => {
  let i = slides.findIndex((s) => s.entity.eid == eid)
  let j = i + by
  if (i < 0 || j < 0 || j >= slides.length) return []
  let [a, b] = [slides[i], slides[j]]
  let [x, y] = [a.slide.ord ?? i, b.slide.ord ?? j]
  if (x == y) [x, y] = [i, j]
  return [
    { entity: { eid: a.entity.eid }, slide: { ord: y } },
    { entity: { eid: b.entity.eid }, slide: { ord: x } },
  ]
}

let known = (pairs, value, fallback) =>
  pairs.some(([v]) => v == value) ? value : fallback

/** How a slide is laid out: a slide without a photo is words only. */
export let layoutOf = (s) =>
  s.slide.photo ? known(LAYOUTS, s.slide.layout, 'photo') : 'words'

export let lookOf = (show) => known(LOOKS, show?.show.look, 'warm')

/** Seconds each slide stays up; 0 means it waits for a tap. */
export let paceOf = (show) => {
  let s = show?.show.seconds
  return typeof s == 'number' && s >= 0 ? Math.min(s, 600) : 8
}

/** The slide `by` steps from `i`, going round from the last to the first. */
export let step = (i, n, by) => n ? (((i + by) % n) + n) % n : 0

/** The slide a show plays from after its slides changed under it: the same
 * slide where it moved to, else the one that took its place. */
export let keep = (slides, eid, i) => {
  let at = slides.findIndex((s) => s.entity.eid == eid)
  return at >= 0 ? at : Math.max(0, Math.min(i, slides.length - 1))
}

/** A photo's size once its long side is at most `max`, never enlarged. */
export let fit = (width, height, max = 2048) => {
  let scale = Math.min(1, max / Math.max(width, height))
  return [Math.round(width * scale), Math.round(height * scale)]
}

/** "6 slides, 8 seconds each" */
export let summary = (show, count) => {
  let pace = paceOf(show)
  return `${count} ${count == 1 ? 'slide' : 'slides'}${
    count ? `, ${pace ? `${pace} seconds each` : 'moved on by hand'}` : ''
  }`
}
