// The apply() band's write as the reader scrolls through its phases: each
// phase passed has happened, and the letter the band writes is shown as each
// phase left it, with what that phase did to it.
import { equal, test } from '@yaks/testing'
import { PHASES } from '@yaks/graph/plugin'
import { seen, stagesOf, standing } from './bands.ts'
import { allot, played } from './told.ts'
import { yak } from './yak.ts'
import { term } from './term.ts'
import { figure } from './figure.ts'
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

// Each trigger's share in a window 1000 tall, live from 100 in at its bottom
// to 100 in at its top: how far the page scrolls before it starts and ends.
let shares = (tops: number[]) =>
  allot(tops, 100, 900).map(([a, b]) => [Math.round(a), Math.round(b)])

test('a lone trigger plays over the window less its buffers, and backwards as the reader goes back', () => {
  equal(shares([500]), [[-400, 400]])
  equal([950, 900, 500, 100, 50].map((t) => played([t], 1000)[0]), [
    0,
    0,
    .5,
    1,
    1,
  ])
})

test('triggers in view together share out the scrolling they are live for, one after another', () => {
  equal(shares([500, 520, 540]), [[-400, -120], [-120, 160], [160, 440]])
  equal(shares([400, 420, 440, 460, 480]), [
    [-500, -324],
    [-324, -148],
    [-148, 28],
    [28, 204],
    [204, 380],
  ])
})

test('in a tall band the triggers share the whole of its scrolling, and only scrolling where none is live goes unused', () => {
  equal(shares([0, 600, 1200]), [[-900, -233], [-233, 433], [433, 1100]])
  equal(shares([0, 2000]), [[-900, -100], [1100, 1900]])
})

test('a trigger that must be done before it leaves gets less, and those beside it share the rest', () => {
  equal(shares([0, 0, 700]), [[-900, -500], [-500, -100], [-100, 600]])
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
