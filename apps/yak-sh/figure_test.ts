// The page's drawing as its reader scrolls the story and every band: after
// each step and each beat, nothing it draws is tangled.
import { equal, test } from '@yaks/testing'
import { type Layout, mount, tangles } from '@yaks/diagram'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { turns } from './turns.ts'
import { beatsOf, scriptOf, SECTIONS, seed } from './site.ts'
import { SHEET, STORY } from './figure.ts'

/** The story's drawing after each step and beat, as the page draws it. */
let story = async () => {
  let y = await yak()
  await y.graph.apply(seed())
  await y.settled()
  let t = term(y)
  let bands = turns(y, t)
  let drawn: Layout | undefined
  let m = mount({ innerHTML: '' }, {
    graph: y.graph,
    query: STORY,
    ...SHEET,
    stage: t.stage,

    drawn: (l) => void (drawn = l),
  })
  let shots: [string, Layout][] = []
  let shot = async (said: string) => {
    await y.settled()
    await m.redraw()
    shots.push([said, drawn!])
  }
  let steps = SECTIONS.filter((s) => s.view == 'Step').map((s) => s.body)
  for (let [n, body] of steps.entries()) {
    for (let m = 1; m <= scriptOf(body).length; m++) {
      await t.reach(steps, n + 1, m)
      await t.idle()
      await shot(`step ${n + 1}.${m}`)
    }
  }
  let stack = SECTIONS.find((s) => s.view == 'Stack')!
  await t.once(stack.eid, stack.body)
  await shot('stack')
  let banded = SECTIONS.filter((s) =>
    ['Doors', 'Rules', 'Memory'].includes(s.view)
  )
  for (let s of banded) bands.band(s.eid, beatsOf(s.body).beats)
  for (let s of banded) {
    for (let n = 1; n <= beatsOf(s.body).beats.length; n++) {
      await bands.reach(s.eid, n)
      await shot(`${s.view} beat ${n}`)
    }
  }
  m.stop()
  return shots
}

test("nothing the story's drawing draws is tangled, at any step or beat", async () => {
  let shots = await story()
  equal(
    shots.flatMap(([said, l]) => tangles(l).map((t) => `${said}: ${t}`)),
    [],
  )
})
