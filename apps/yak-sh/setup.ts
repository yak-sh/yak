// "Get set up on yaks.app" (D-138669): one field for an email address. What
// the person types is a draft until they send it; sent, it is a
// `signin_request` bundle in the tab's graph, drawn going through the phases
// of apply() as the band above draws its letter, and its effect, the one on
// the page that leaves the tab, asks yaks.app's sign-in door for the
// Operator's letter (signin.ts). Then the section says what happens next.
import { type FunctionComponent, h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { type Phase, PHASES } from '@yaks/graph/plugin'
import type { Bundle } from '@yaks/graph'
import { Prose, words } from './prose.ts'
import type { Ctx } from './views.ts'
import type { Change } from './yak.ts'
import { text, useTold } from './told.ts'
import { ANCHORS } from './site.ts'
import { numbered, partOf } from './parts.ts'
import { Phases, seen, Source, stagesOf, standing } from './bands.ts'
import { PLACE } from './signin.ts'

/** How long each phase stays the one lit, in ms. */
const STEP = 110

const LAST = PHASES.length - 1
const EFFECT = PHASES.indexOf('effect')

/** The bundle an address typed becomes. */
export let asked = (address: string): Bundle => ({
  entity: { eid: '$ask' },
  signin_request: { address },
})

/** The write as the page calls it, for the first line of its phases. */
let called = (address: string) =>
  `graph_apply ${JSON.stringify({ bundles: [asked(address)] })}`

// The ask the person last sent: its write, and what its effect wrote to it
// after the commit.
type Ask = { eid: string; change: Change; later: Bundle[] }

/** What the section says once the door has answered, or while it is asked. */
let Told = ({ address, row, upto }: {
  address: string
  row?: Bundle
  upto: number
}) =>
  upto < EFFECT
    ? null
    : row?.signin_sent
    ? h('div', { class: 'Setup_Told is-sent', role: 'status' }, [
      h('b', null, 'Sent. Check your email.'),
      h(Prose, {
        source:
          `A letter from yaks.app's Operator is on its way to **${address}**, with a code and a link that signs you in. Or just reply to it, and the Operator sets you up from there.`,
      }),
      h('p', null, 'Nothing in a few minutes? Look in spam, or send it again.'),
    ])
    : row?.signin_refused
    ? h('div', { class: 'Setup_Told is-refused', role: 'status' }, [
      h('b', null, "That isn't an email address."),
      h('p', null, "It's back in the box: check it, and send it again."),
    ])
    : h('div', { class: 'Setup_Told', role: 'status' }, [
      h('b', null, words("Asking yaks.app's sign-in door…")),
    ])

export let Setup: FunctionComponent<Ctx & { e: Bundle }> = (ctx) => {
  let { e, yak } = ctx
  let eid = e.entity.eid
  useTold((l) => yak.watch('*', l))
  let [ask, setAsk] = useState<Ask>()
  useEffect(() =>
    yak.listen((change) => {
      let made = !change.generation &&
        change.bundles.find((b) => b.signin_request)
      if (made) return setAsk({ eid: made.entity.eid, change, later: [] })
      if (!change.generation) return
      setAsk((a) => {
        let more = change.bundles.filter((b) => b.entity.eid == a?.eid)
        return a && more.length ? { ...a, later: [...a.later, ...more] } : a
      })
    }), [])
  // Each phase lights in turn once the ask is written; where nothing paints
  // frames, as in a test, all of them at once.
  let [upto, setUpto] = useState(-1)
  useEffect(() => {
    if (!ask) return
    if (typeof requestAnimationFrame == 'undefined') return setUpto(LAST)
    setUpto(-1)
    let t = setInterval(() =>
      setUpto((u) => {
        if (u >= LAST) clearInterval(t)
        return Math.min(LAST, u + 1)
      }), STEP)
    return () => clearInterval(t)
  }, [ask?.eid])
  let row = ask && yak.row(ask.eid)
  let address = row ? text(row, 'signin_request', 'address') : ''
  // A refused address goes back in the box, so nothing typed is lost.
  let refused = !!row?.signin_refused
  useEffect(() => {
    if (refused && !yak.drafts.text(PLACE)) yak.drafts.restore(PLACE, address)
  }, [refused])
  let typed = yak.drafts.text(PLACE)
  let stages = ask
    ? stagesOf(ask.change.steps, ask.eid, ask.later)
    : new Map<Phase, Bundle>()
  let state = standing(new Set(ask?.change.phases), upto)
  let { rows, changed } = seen(stages, upto, yak.vocab)
  let { head, pieces } = partOf(text(e, 'doc', 'body'))
  let send = (ev: Event) => {
    ev.preventDefault()
    let address = yak.drafts.text(PLACE).trim()
    if (address) void yak.drafts.spend(PLACE, [asked(address)])
  }
  return h('section', {
    class: 'Part Setup',
    id: ANCHORS[eid],
    'data-eid': eid,
  }, [
    h('div', { class: 'Part_Head' }, [
      h('span', { class: 'Bubble' }, String(numbered(yak, eid))),
      h('h2', null, words(text(e, 'doc', 'title'))),
      h(Prose, { source: head }),
    ]),
    h('div', { class: 'Part_Body' }, [
      h('form', { class: 'Setup_Form', onSubmit: send }, [
        h('label', { for: 'setup-address' }, 'Your email address'),
        h('div', { class: 'Setup_Field' }, [
          h('input', {
            id: 'setup-address',
            type: 'email',
            name: 'address',
            autocomplete: 'email',
            placeholder: 'you@example.com',
            required: true,
            value: typed,
            onInput: (ev: Event) =>
              yak.drafts.type(
                PLACE,
                (ev.currentTarget as HTMLInputElement).value,
              ),
          }),
          h('button', { type: 'submit' }, 'Email me'),
        ]),
      ]),
      ...pieces.map((p) =>
        p.kind == 'md' ? h(Prose, { source: p.text }) : null
      ),
      h(Told, { address, row, upto }),
      h('div', { class: 'Setup_Write' }, [
        h(Phases, {
          state,
          call: {
            kind: 'web',
            text: called(address || typed || 'you@example.com'),
          },
          made: !!ask,
        }),
        h('figure', { class: 'Stack_Figure' }, [
          rows.length ? h(Source, { rows, changed, state }) : null,
          h('figcaption', null, [
            h('span', { class: 'No' }, 'Fig. 3'),
            ask
              ? 'Your ask, as the bundle that wrote it: each phase changes it as apply() did, and its effect records what the door said.'
              : 'Send your address, and the bundle it becomes is drawn here.',
          ]),
        ]),
      ]),
    ]),
  ])
}
