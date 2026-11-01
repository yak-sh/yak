// The practice planner's logic, with nothing of the page in it: when each
// block starts, how long the practice runs, which practices are coming up,
// and the bundles that copy a practice or move a block.
//
// A practice is `practice{date, start, team, focus}` with its notes in
// `doc.body`. A block is `block{practice, ord, minutes, kind}` with the drill's
// name and coaching points in `doc`, copied when it is added, so changing the
// drill library never rewrites a practice already run. A drill is
// `drill{minutes, kind, equipment}` with its name and points in `doc`.

export let KINDS = [
  'Warm-up',
  'Skills',
  'Team play',
  'Conditioning',
  'Cool-down',
]

export let EVERYTHING = '(.practice|.block|.drill)&?doc&.limit=5000'

let DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
let MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Rows of one answer, sorted under their own component. */
export let split = (rows) => ({
  practices: rows.filter((r) => r.practice),
  blocks: rows.filter((r) => r.block),
  drills: rows.filter((r) => r.drill),
})

/** "15:30" as minutes after midnight; null when it is not a time. */
export let clock = (text) => {
  let m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  return +m[1] * 60 + +m[2]
}

/** Minutes after midnight as a time on a gym clock: 930 is "3:30". */
export let hm = (mins) => {
  let h = Math.floor(mins / 60) % 24
  let m = String(mins % 60).padStart(2, '0')
  return `${h % 12 || 12}:${m}`
}

/** "3:30 pm", for the start and end of a whole practice. */
export let hmDay = (mins) =>
  `${hm(mins)} ${Math.floor(mins / 60) % 24 < 12 ? 'am' : 'pm'}`

/** A block's length, from what was typed: a whole number of minutes, 1 to 240. */
export let minutes = (text) => {
  let n = Math.round(Number(String(text ?? '').trim()))
  return Number.isFinite(n) && n >= 1 && n <= 240 ? n : null
}

/** A practice's blocks, in running order. */
export let ordered = (blocks, practice) =>
  blocks
    .filter((b) => ref(b.block.practice) == practice)
    .sort((a, b) => (a.block.ord ?? 0) - (b.block.ord ?? 0))

let ref = (r) => (r && typeof r == 'object' ? r.eid : r)

/** Each block with the clock time it starts and ends, from the practice start. */
export let timeline = (start, blocks) => {
  let at = clock(start) ?? 0
  return blocks.map((b) => {
    let from = at
    at += b.block.minutes ?? 0
    return { row: b, from, to: at }
  })
}

export let total = (blocks) =>
  blocks.reduce((sum, b) => sum + (b.block.minutes ?? 0), 0)

/** The ord a new block takes at the end of a practice. */
export let after = (blocks) =>
  blocks.reduce((top, b) => Math.max(top, b.block.ord ?? 0), 0) + 1

/** The patches that swap a block with its neighbour; none at either end. */
export let move = (blocks, eid, by) => {
  let i = blocks.findIndex((b) => b.entity.eid == eid)
  let j = i + by
  if (i < 0 || j < 0 || j >= blocks.length) return []
  let [a, b] = [blocks[i], blocks[j]]
  let [x, y] = [a.block.ord ?? i, b.block.ord ?? j]
  if (x == y) [x, y] = [i, j]
  return [
    { entity: { eid: a.entity.eid }, block: { ord: y } },
    { entity: { eid: b.entity.eid }, block: { ord: x } },
  ]
}

/** Today in the visitor's own calendar, as "2026-11-03". */
export let today = (now = new Date()) =>
  [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

/** Practices still to come, soonest first, and the ones run, latest first. */
export let calendar = (practices, day) => {
  let by = (a, b) =>
    (a.practice.date ?? '').localeCompare(b.practice.date ?? '') ||
    (clock(a.practice.start) ?? 0) - (clock(b.practice.start) ?? 0)
  let sorted = [...practices].sort(by)
  return {
    next: sorted.filter((p) => (p.practice.date ?? '') >= day),
    past: sorted.filter((p) => (p.practice.date ?? '') < day).reverse(),
  }
}

let parse = (iso) => {
  let [y, m, d] = String(iso ?? '').split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : null
}

/** "Tuesday, November 3". */
export let longDate = (iso) => {
  let d = parse(iso)
  return d ? `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}` : ''
}

/** "Tue Nov 3", where a row has little room. */
export let shortDate = (iso) => {
  let d = parse(iso)
  return d
    ? `${DAYS[d.getDay()].slice(0, 3)} ${
      MONTHS[d.getMonth()].slice(0, 3)
    } ${d.getDate()}`
    : ''
}

/** The day a week after another: a practice copied for next week. */
export let weekAfter = (iso) => {
  let d = parse(iso)
  if (!d) return ''
  d.setDate(d.getDate() + 7)
  return today(d)
}

/** One batch that makes a practice like another, on a new date, with its blocks. */
export let copy = (practice, blocks, date) => [
  {
    entity: { eid: '$practice' },
    practice: { ...practice.practice, date },
    doc: { title: practice.doc?.title ?? '' },
  },
  ...blocks.map((b, i) => ({
    entity: { eid: `$block${i}` },
    block: {
      practice: '$practice',
      ord: i + 1,
      minutes: b.block.minutes,
      kind: b.block.kind ?? '',
    },
    doc: { title: b.doc?.title ?? '', body: b.doc?.body ?? '' },
  })),
]

/** A drill from the library, as a block at the end of a practice. */
export let fromDrill = (drill, practice, ord) => ({
  entity: { eid: '$block' },
  block: {
    practice,
    ord,
    minutes: drill.drill.minutes ?? 10,
    kind: drill.drill.kind ?? '',
  },
  doc: { title: drill.doc?.title ?? '', body: drill.doc?.body ?? '' },
})

/** The library, grouped by kind in the order a practice runs. */
export let shelves = (drills) => {
  let named = (d) => d.doc?.title ?? ''
  let known = KINDS.map((kind) => ({
    kind,
    drills: drills.filter((d) => d.drill.kind == kind)
      .sort((a, b) => named(a).localeCompare(named(b))),
  }))
  let other = drills.filter((d) => !KINDS.includes(d.drill.kind))
  return [...known, { kind: 'Other', drills: other }].filter((s) =>
    s.drills.length
  )
}

/** A number of minutes said the way a coach says it: "1 hr 45 min". */
export let length = (mins) => {
  let h = Math.floor(mins / 60), m = mins % 60
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`
}
