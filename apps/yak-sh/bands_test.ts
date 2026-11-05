// The apply() band's write as the reader scrolls through its phases: each
// phase passed has happened, and the letter the band writes is shown as each
// phase left it, with what that phase did to it.
import { equal, test } from '@yaks/testing'
import { PHASES } from '@yaks/graph/plugin'
import { seen, stagesOf, standing } from './bands.ts'
import { passed } from './told.ts'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { figure, into, LINE, SPAN } from './figure.ts'
import { SECTIONS } from './site.ts'
import { SHOP, YOURS } from './shop.ts'

let ran = new Set(PHASES.filter((p) => p != 'audit' && p != 'journal'))
let at = (upto: number) => {
  let s = standing(ran, upto)
  return {
    lit: PHASES.filter((p, i) => s.phase(p, i) == 'on').length,
    skipped: PHASES.filter((p, i) => s.phase(p, i) == 'skip'),
    now: s.now,
  }
}
let to = (p: string) => PHASES.indexOf(p as never)

test('the write happens as far as the reader has scrolled, and undoes as they go back', () => {
  equal(at(-2), { lit: 0, skipped: [], now: undefined })
  equal(at(-1), { lit: 0, skipped: [], now: undefined })
  equal(at(to('stamp')), { lit: to('stamp') + 1, skipped: [], now: 'stamp' })
  equal(at(to('commit')).skipped, ['journal'])
  equal(at(to('commit')).now, 'commit')
  equal(at(PHASES.length - 1).skipped, ['journal', 'audit'])
})

test('a phase the write did not run is known before the reader gets to it, and every phase runs until there is a write', () => {
  let skips = (r: Set<string>) => PHASES.filter((p) => !standing(r, -1).runs(p))
  equal([skips(ran), skips(new Set())], [['journal', 'audit'], []])
})

test('the reader is past each phase whose dot is above the reading line', () => {
  equal(
    [passed([500, 600], 400), passed([100, 600], 400), passed([1, 2], 400)],
    [-1, 0, 1],
  )
})

test('a step plays out as its top rises from the reading line over most of the window, and back as the reader goes back', () => {
  let view = 1000
  let at = (top: number) => into(top, view)
  equal(
    [view, LINE, LINE - SPAN / 2, LINE - SPAN, 0].map((f) => at(f * view)),
    [0, 0, .5, 1, 1],
  )
})

test('each phase does its own work on the letter, and its effect delivers it after the commit', async () => {
  let y = await yak({ retry: 0 })
  let t = term(y)
  let f = figure(y, t)
  let steps = SECTIONS.filter((s) => s.view == 'Step').map((s) => s.body)
  await t.reach(steps, steps.length)
  let band = SECTIONS.find((s) => s.view == 'Stack')!
  await t.once(band.eid, band.body)
  await y.settled()
  let { eid, steps: ran, later } = f.last()
  let stages = stagesOf(ran, eid!, later)
  let [paid] = await y.graph.read('.doc.title="Sign up for payments" *')
  // What each phase changed on the letter, and to what.
  let did = (p: string) => {
    let { rows, changed } = seen(stages, to(p), y.vocab)
    let value = (key: string) => {
      let [comp, prop] = key.split('.')
      let row = rows.find((r) => r.key == comp)!
      return prop ? row.props.find(([q]) => q == prop)![1] : 'new'
    }
    return [...changed.keys()].map((k) => [k, value(k)])
  }
  equal(did('normalize'), [])
  equal(did('admit'), [
    ['deliver.to', y.you],
    ['mail.target', paid.entity.eid],
  ])
  equal(did('mint'), [['entity.eid', eid]])
  equal(did('rules'), [['mail.from', SHOP]])
  equal(did('stamp'), [['created', 'new']])
  equal(did('commit'), [])
  equal(did('effect').map(([k]) => k).sort(), [
    'deliver.tried',
    'delivered',
    'mail.message_id',
    'mail.to',
  ])
  equal(seen(stages, to('admit'), y.vocab).changed.get('mail.target'), 'T-3')
  equal(seen(stages, -1, y.vocab).rows[0].props, [['eid', '$letter']])
  equal(
    y.outbox.tries().map((x) => [x.to, x.id]),
    [[YOURS, undefined], [YOURS, 'outbox-1']],
  )
})
