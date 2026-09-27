// The hero's pack, drawn into its panel (panel.ts): what they wear in each
// slot, how they fight in it and the abilities it gives them, everything else
// they carry, and by a village's fire, the rack of plain arms anyone may take
// to try. Each piece of gear is its own, framed and named in its rarity's
// colour (rarity.ts); everything else is a stack of its kind. Tap a thing to
// see, at the sheet's foot, what it is, what it rolled, the abilities it
// gives, and what wearing it would change, then wear it, take it off, or take
// it from the rack; a second dagger, for a hero who knows how, shows what it
// would change in the other hand. B or the tray's bag opens it. It is written
// again only when what it shows changed.
import { ABILITIES, type Doer, does, GIVES, OFF } from './abilities.ts'
import { HANDLES, type Slot, SLOT_NAMES, SLOTS, sortOf } from './arms.ts'
import {
  bare,
  diff,
  doer,
  into,
  LINES,
  numbers,
  rolled,
  trying,
} from './compare.ts'
import { RACK } from './gear.ts'
import { glyphText } from './glyphs.ts'
import { ITEMS, type Thing } from './items.ts'
import { GRADES, type Piece, piece, RARITIES, tint } from './rarity.ts'
import { icon } from './sprites.ts'
import type { Panel } from './panel.ts'
import type { Frame, Sheet } from './play.ts'
import { type Held, need } from './rules.ts'
import { formOf } from './skills.ts'
import { tipped } from './tip.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export type Acts = {
  wear: (slot: Slot, item?: string) => void
  take: (kind: string) => void
}

// The abilities a weapon or a thing for the other hand gives, held in `slot`,
// and what each does, as the hero would do it holding it: with the skills
// they know (`learned`), and the blow and health it would give them.
let gives = (t: Thing, slot: Slot | undefined, learned: string[], d: Doer) => {
  let ids = slot == 'main'
    ? GIVES[t.family ?? ''] ?? []
    : slot == 'off'
    ? [OFF[t.family ?? '']].filter((id) => id)
    : []
  return ids.flatMap((id) => {
    let a = formOf(id, learned)
    return a
      ? [
        `<span class=Pack_Ability>${glyphText(a.icon)}<b>${esc(a.name)}</b> ${
          esc(does(a, d))
        }</span>`,
      ]
      : []
  }).join('')
}

// A thing's tier, as pips.
let pips = (t?: Thing) =>
  t?.tier ? `<i class=Pack_Tier>${'•'.repeat(t.tier)}</i>` : ''

// What sort of thing a piece of gear is: its rarity when finer than common,
// its sort, and its tier.
let sortLine = (t: Piece) =>
  `${t.rarity == 'common' ? '' : `${GRADES[t.rarity].name} · `}${sortOf(t)}${
    t.tier ? ` · tier ${t.tier}` : ''
  }`

/** The pack, drawn into its panel (panel.ts). */
export let pack = (panel: Panel, acts: Acts) => {
  let box = panel.body
  // What is picked: a slot worn, a row in the bag, or a kind on the rack.
  let picked: { from: 'worn' | 'bag' | 'rack'; key: string } | null = null
  let sheet: Sheet | null = null
  let was: unknown[] = []
  box.addEventListener('click', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let s = sheet
    let pick = t?.closest<HTMLElement>('[data-pick]')?.dataset.pick
    let act = t?.closest<HTMLElement>('[data-do]')?.dataset.do
    if (pick) {
      let [from, key] = pick.split(':') as ['worn' | 'bag' | 'rack', string]
      picked = picked?.from == from && picked.key == key ? null : { from, key }
    } else if (act && s && picked) {
      let { from, key } = picked
      if (act == 'off') acts.wear(key as Slot)
      if (act == 'wear' || act == 'twin') {
        let h = s.bag.find((h) => h.eid == key)
        let slot = act == 'twin' ? 'off' : ITEMS[h?.kind ?? '']?.slot
        if (h && slot) acts.wear(slot, h.eid)
        picked = slot ? { from: 'worn', key: slot } : null
      }
      if (act == 'take' && from == 'rack') {
        acts.take(key)
        picked = { from: 'worn', key: into(s, key) ?? '' }
      }
    }
    was = []
  })

  // What the hero carries beyond what they wear: each piece of gear on its
  // own, the finest first, then a stack for each other kind, by name, picked
  // by its first row.
  let carried = (s: Sheet) => {
    let wearing = new Set(Object.values(s.worn).map((w) => w?.eid))
    let gear: { h: Held; n: number }[] = []
    let stacks = new Map<string, { h: Held; n: number }>()
    for (let h of s.bag) {
      let st = stacks.get(h.kind)
      if (wearing.has(h.eid)) continue
      else if (ITEMS[h.kind]?.slot) gear.push({ h, n: 1 })
      else if (st) st.n += h.n
      else stacks.set(h.kind, { h, n: h.n })
    }
    let rank = (h: Held) =>
      RARITIES.indexOf(h.rarity ?? 'common') * 10 + (ITEMS[h.kind]?.tier ?? 0)
    let byName = (a: { h: Held }, b: { h: Held }) =>
      piece(a.h).name.localeCompare(piece(b.h).name)
    return [
      ...gear.sort((a, b) => rank(b.h) - rank(a.h) || byName(a, b)),
      ...[...stacks.values()].sort(byName),
    ]
  }

  let tile = (pick: string, h: Held, n = 1, on = false, had = false) => {
    let p = piece(h)
    return `<button class="Pack_Tile ${tint(p.rarity)}${
      on ? ' Pack_Tile-on' : ''
    }${had ? ' Pack_Tile-had' : ''}" data-pick="${pick}"${
      tipped({ name: p.name, note: p.slot ? sortLine(p) : undefined })
    }><i>${icon(h.kind) || '•'}</i>${n > 1 ? `<b>${n}</b>` : ''}${
      pips(p)
    }</button>`
  }

  // What a thing is, what wearing it would change, and what can be done.
  let card = (s: Sheet, f: Frame) => {
    if (!picked) {
      return `<p class=Pack_Hint>Tap something to see what it is.</p>`
    }
    let { from, key } = picked
    let h = from == 'worn'
      ? s.worn[key as Slot]
      : from == 'bag'
      ? s.bag.find((h) => h.eid == key)
      : { eid: key, kind: key, n: 1 }
    let t = h && ITEMS[h.kind] && piece(h)
    if (!h || !t) return `<p class=Pack_Hint>Nothing worn there.</p>`
    let kind = h.kind
    let slot = from == 'worn' ? key as Slot : into(s, kind)
    let now = numbers(s, s.worn)
    let then = from == 'worn'
      ? numbers(s, bare(s.worn, key))
      : numbers(s, trying(s.worn, h, slot))
    let both = HANDLES[t.family ?? '']?.hands == 2 ? ' · both hands' : ''
    let what = t.slot
      ? `${sortLine(t)}${both}`
      : t.heals
      ? `Drink it to mend ${t.heals} (Q)`
      : 'Carried'
    // Worn, what taking it off loses; else, what putting it on gains.
    let changes = !t.slot
      ? ''
      : from == 'worn'
      ? diff(then, now)
      : diff(now, then)
    // The rack gives one of each, and a second of a blade for the other hand.
    let held = s.bag.filter((b) => b.kind == kind).length >=
      (slot == t.slot ? 1 : 2)
    let act = from == 'worn'
      ? `<button class="Btn Btn-small" data-do=off>Take it off</button>`
      : from == 'rack'
      ? f.rack
        ? held
          ? `<span class=Pack_Hint>You have one.</span>`
          : `<button class="Btn Btn-go Btn-small" data-do=take>Take it</button>`
        : ''
      : slot == 'off' && t.slot == 'main'
      ? `<button class="Btn Btn-small" data-do=wear>Hold it</button><button class="Btn Btn-go Btn-small" data-do=twin>Other hand</button>`
      : t.slot
      ? `<button class="Btn Btn-go Btn-small" data-do=wear>${
        t.slot == 'main' || t.slot == 'off' ? 'Hold it' : 'Wear it'
      }</button>`
      : ''
    let can = gives(
      t,
      slot,
      s.learned,
      doer(s, from == 'worn' ? s.worn : trying(s.worn, h, slot)),
    )
    let rolls = rolled(t)
    return `<div class=Pack_Card><i class="Pack_Big ${tint(t.rarity)}">${
      icon(kind)
    }</i><div><b class="Rarity ${tint(t.rarity)}">${esc(t.name)}</b><span>${
      esc(what)
    }</span></div>${act}</div>${
      rolls
        ? `<div class="Pack_Rolled Rarity ${tint(t.rarity)}">${rolls}</div>`
        : ''
    }${can ? `<div class=Pack_Abilities>${can}</div>` : ''}${
      changes ? `<div class=Pack_Nums>${changes}</div>` : ''
    }`
  }

  let draw = (s: Sheet, f: Frame) => {
    let n = numbers(s, s.worn)
    let worn = SLOTS.map((slot) => {
      let h = s.worn[slot], t = h && piece(h)
      let on = picked?.from == 'worn' && picked.key == slot
      return `<button class="Pack_Slot ${tint(t?.rarity)}${
        on ? ' Pack_Tile-on' : ''
      }${t ? '' : ' Pack_Slot-empty'}" data-pick="worn:${slot}"><small>${
        SLOT_NAMES[slot]
      }</small><i>${h ? icon(h.kind) : '·'}</i><span class=Rarity>${
        esc(t?.name ?? (slot == 'main' ? 'Bare hands' : 'Nothing'))
      }</span>${pips(t)}</button>`
    }).join('')
    let stats = LINES.filter(([k]) => (k != 'speed' && k != 'twin') || n[k])
      .map((
        [k, mark, say],
      ) => `<span class=Pack_Num>${glyphText(mark)} ${say(n[k])}</span>`).join(
        '',
      ) +
      s.abilities.map((id, i) =>
        ABILITIES[id]
          ? `<span class=Pack_Num><kbd class=Key>${i + 1}</kbd> ${
            glyphText(ABILITIES[id].icon)
          } ${esc(ABILITIES[id].name)}</span>`
          : ''
      ).join('')
    let bag = carried(s).map(({ h, n }) =>
      tile(`bag:${h.eid}`, h, n, picked?.from == 'bag' && picked.key == h.eid)
    ).join('')
    let rack = f.rack
      ? `<h3 class=Pack_Head>By the fire: plain arms for anyone to try</h3><div class=Pack_Grid>${
        RACK.map((k) =>
          tile(
            `rack:${k}`,
            { eid: k, kind: k, n: 1 },
            1,
            picked?.from == 'rack' && picked.key == k,
            s.bag.some((h) => h.kind == k),
          )
        ).join('')
      }</div>`
      : ''
    let from = need(s.lvl), to = need(s.lvl + 1)
    panel.head(
      `${
        esc(s.name)
      } <span class=Badge>Level ${s.lvl}</span><small class=Panel_Note>${
        s.xp - from
      } / ${to - from} xp</small>`,
    )
    box.innerHTML = `<div class=Pack>` +
      `<div class=Pack_Worn>${worn}</div>` +
      `<div class=Pack_Nums>${stats}</div>` +
      `<h3 class=Pack_Head>In your bag</h3>` +
      `<div class=Pack_Grid>${
        bag || '<span class=Pack_Hint>Your bag is empty.</span>'
      }</div>${rack}` +
      `<div class=Pack_Pick>${card(s, f)}</div></div>`
  }

  return {
    /** show this frame's sheet, when the pack is open and it changed; what
     * was picked is let go once it folds away */
    show: (f: Frame) => {
      sheet = f.sheet
      if (!panel.open) {
        picked = null
        was = []
        return
      }
      let key = [f.sheet, f.rack, picked]
      if (key.every((k, i) => k === was[i])) return
      was = key
      draw(f.sheet, f)
    },
  }
}
