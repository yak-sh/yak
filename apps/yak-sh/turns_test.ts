// The bands' turns over the page's graph and prompt, run in this process as
// the page runs them in a tab, without drawing it.
import { equal, test } from '@yaks/testing'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { turns } from './turns.ts'
import { beatsOf, files, SECTIONS, seed } from './site.ts'

let dir = new URL('./', import.meta.url)
let steps = SECTIONS.filter((s) => s.view == 'Step').map((s) => s.body)
let BANDS = SECTIONS.filter((s) =>
  ['Doors', 'Rules', 'Memory'].includes(s.view)
)
let STACK = SECTIONS.find((s) => s.view == 'Stack')!
let all = (b: typeof BANDS[0]) => beatsOf(b.body).beats.length

// The page as `start` makes it, its bands told their beats in the order the
// page draws them.
let page = async () => {
  let y = await yak({ retry: 0 })
  await y.graph.apply(seed())
  await y.graph.apply(await files((path) => fetch(new URL(path, dir))))
  await y.settled()
  let t = term(y)
  let d = turns(y, t)
  for (let b of BANDS) d.band(b.eid, beatsOf(b.body).beats)
  let settle = async () => {
    await t.idle()
    await d.idle()
    await y.settled()
  }
  return { t, d, settle }
}

// Where a reader can arrive: the top, or past a band's first beat, every
// band above it passed. The page measures its bands as it mounts, before the
// story, a band below the reader at nothing; then the reader scrolls on to
// the bottom.
let arrivals = [
  { at: -1, n: 0 },
  ...BANDS.flatMap((b, at) => [1, all(b)].map((n) => ({ at, n }))),
]

test('every example call in the bands succeeds wherever the reader arrives', async () => {
  let faults = await Promise.all(arrivals.map(async ({ at, n }) => {
    let { t, d, settle } = await page()
    if (at >= 0) t.once(STACK.eid, STACK.body)
    BANDS.forEach((b, i) => d.reach(b.eid, i < at ? all(b) : i == at ? n : 0))
    t.reach(steps, at >= 0 ? steps.length : 0)
    await settle()
    t.reach(steps, steps.length)
    t.once(STACK.eid, STACK.body)
    for (let b of BANDS) await d.reach(b.eid, all(b))
    await settle()
    return [
      at,
      n,
      BANDS.flatMap((b) =>
        beatsOf(b.body).beats.flatMap((beat, i) => {
          let done = d.done(b.eid, i)
          return done && !done.fault
            ? []
            : [`${beat.line}: ${done?.out.join(' ')}`]
        })
      ),
    ]
  }))
  equal(faults, arrivals.map(({ at, n }) => [at, n, []]))
})
