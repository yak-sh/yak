// The deals panel (panel.ts): what stands between the hero and the villager
// they are beside (deals.ts says which stand). Each deal: what it gives, each
// step it asks and how far along it is, how long it stands, and what the hero
// can do about it: agree, turn it down, trade, or hand it in. The villager
// opens it: talked to while a deal stands, or making an offer. It folds away
// once the hero walks off, and is drawn only while open and only when what it
// shows changed.
import { BEASTS } from './beasts.ts'
import type { View } from './deals.ts'
import { ITEMS } from './items.ts'
import type { Panel } from './panel.ts'
import { said } from './stock.ts'
import { split } from './ui/split.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** What a hero can do about a deal. */
export type Act = 'agree' | 'refuse' | 'hand'
let ACTS: Act[] = ['agree', 'refuse', 'hand']

let MIN = 60_000

// How long a deal still stands, as a person reads it.
let left = (ms: number) =>
  ms < 90 * MIN
    ? `${Math.max(1, Math.round(ms / MIN))} min`
    : `${Math.round(ms / (60 * MIN))} h`

/** A creature's name, or a thing's. */
export let nameOf = (kind: string) =>
  BEASTS[kind]?.name ?? ITEMS[kind]?.name ?? kind

// The buttons of a deal: a trade that asks nothing but things already in the
// bag is done at once; anything else is agreed to first, then handed in once
// every step is done.
let buttons = (v: View) => {
  let b = (act: Act, label: string, go = false) =>
    `<button class="Btn${
      go ? ' Btn-go' : ''
    }" type=button data-do=${act} data-deal="${esc(v.eid)}">${label}</button>`
  if (v.state == 'taken') return v.ready ? b('hand', 'Hand it in', true) : ''
  return (v.ready && !v.steps.some((s) => s.deed)
    ? b('hand', 'Trade', true)
    : b('agree', 'Agree', true)) + b('refuse', 'No thanks')
}

let card = (v: View, now: number) =>
  `<div class=Deal><p class=Deal_Give>${
    v.state == 'taken' ? 'Promised you' : 'Offers you'
  } <b>${esc(said(v.give))}</b>, for:</p><ul class=Deal_Steps>${
    v.steps.map((s) =>
      `<li class="Deal_Step${s.have >= s.n ? ' Deal_Step-done' : ''}">${
        s.deed ? 'Fell' : 'Bring'
      } ${esc(nameOf(s.kind))}<span>${s.have} / ${s.n}</span></li>`
    ).join('')
  }</ul><p class=Deal_Ends>${
    v.state == 'taken' ? 'You agreed. It stands' : 'The offer stands'
  } ${left(v.ends - now)} more.</p><div class=Deal_Acts>${
    buttons(v)
  }</div></div>`

/** The deals panel; `act` is told what the hero chose. */
export let dealbox = (panel: Panel, act: (a: Act, v: View) => void) => {
  let panes = split(panel.body)
  let shown: View[] = []
  let picked: string | null = null
  let now = 0
  let at = ''
  panel.body.addEventListener('click', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let select = t?.closest<HTMLButtonElement>('button[data-select]')
    if (select && shown.some((v) => v.eid == select.dataset.select)) {
      picked = select.dataset.select!
      draw()
      return
    }
    let b = t?.closest<HTMLButtonElement>('button[data-do]')
    let a = ACTS.find((x) => x == b?.dataset.do)
    let v = shown.find((v) => v.eid == b?.dataset.deal)
    if (a && v) act(a, v)
  })
  let draw = () => {
    let selected = shown.find((v) => v.eid == picked)
    if (!selected) picked = null
    let rows =
      shown.map((v) =>
        `<button class=Split_Row type=button data-select="${esc(v.eid)}"><b>${
          esc(said(v.give))
        }</b><small>${v.state == 'taken' ? 'Agreed' : 'Offered'}${
          v.ready ? ' · Ready' : ''
        }</small><small>For ${esc(said(v.take))}</small></button>`
      ).join('') ||
      '<p class=Deal_None>Nothing stands between you. Ask what they might trade.</p>'
    panes.render(
      rows,
      selected
        ? card(selected, now)
        : `<p class=Deal_None>${
          shown.length
            ? 'Select a deal to see its steps and what you can do.'
            : 'Talk to the villager about a new offer.'
        }</p>`,
      picked,
    )
  }

  return {
    /** open it beside a villager, by their id and name */
    open: (id: string, name: string) => {
      if (id != at || !panel.open) {
        picked = null
        shown = []
        draw()
      }
      at = id
      panel.head(esc(name))
      panel.show()
    },
    /** this frame's deals with the villager the hero is beside, by their
     * id: walked off from the one it is open at, it folds away */
    paint: (views: View[], id: string | null, time: number) => {
      if (!panel.open) return
      if (id != at) return panel.close()
      shown = views
      now = time
      draw()
    },
  }
}
