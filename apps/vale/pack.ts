// The hero's pack, drawn into its panel (panel.ts): what they wear in each
// slot, how they fight in it and the abilities it gives them, everything else
// they carry, and by a village's fire, the rack of plain arms anyone may take
// to try. Tap a thing to see what it is, the abilities it gives, and what
// wearing it would change, then wear it, take it off, or take it from the
// rack. B or the tray's bag opens it. It is written again only when what it
// shows changed.
import { ABILITIES, GIVES } from './abilities.ts'
import { HANDLES, type Slot, SLOT_NAMES, SLOTS, sortOf } from './arms.ts'
import { kitOf, RACK, type Worn } from './gear.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { ITEMS, type Thing } from './items.ts'
import { icon } from './sprites.ts'
import type { Panel } from './panel.ts'
import type { Frame, Sheet } from './play.ts'
import { maxHp, need, power } from './rules.ts'
import { skilled } from './skills.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export type Acts = {
  wear: (slot: Slot, item?: string) => void
  take: (kind: string) => void
}

// What a hero would do wearing `worn`, with their level and skills, in the
// numbers a sheet shows.
let numbers = ({ lvl, learned }: Sheet, worn: Worn) => {
  let k = skilled(kitOf(worn), learned, maxHp(lvl))
  return {
    blow: Math.round(power(lvl, k.dmg) * (1 + k.force)),
    pace: k.pace / 1000,
    reach: k.reach,
    armour: k.armour,
    hp: maxHp(lvl) + k.hp,
    speed: Math.round(k.speed * 100),
    luck: Math.round((0.12 + k.luck) * 100),
  }
}
type Numbers = ReturnType<typeof numbers>

// Each number, how it reads, and whether more is better.
let LINES: [keyof Numbers, Glyph, (n: number) => string, boolean][] = [
  ['blow', 'blow', (n) => `${n} a blow`, true],
  ['pace', 'pace', (n) => `every ${n.toFixed(2)} s`, false],
  ['reach', 'reach', (n) => `reach ${n} m`, true],
  ['armour', 'armour', (n) => `armour ${n}`, true],
  ['hp', 'health', (n) => `health ${n}`, true],
  ['speed', 'speed', (n) => `speed +${n}%`, true],
  ['luck', 'luck', (n) => `great blows ${n}%`, true],
]

// What the hero would wear with `kind` put on in its slot: a weapon for both
// hands empties the other, and a thing for the other hand drops one.
let trying = (worn: Worn, kind: string): Worn => {
  let t = ITEMS[kind]
  if (!t?.slot) return worn
  let next: Worn = { ...worn, [t.slot]: { eid: '?', kind, n: 1 } }
  let main = ITEMS[next.main?.kind ?? '']
  if (t.slot == 'main' && HANDLES[t.family ?? '']?.hands == 2) delete next.off
  if (t.slot == 'off' && HANDLES[main?.family ?? '']?.hands == 2) {
    delete next.main
  }
  return next
}

// What the hero would wear with a slot taken off.
let bare = (worn: Worn, slot: string): Worn =>
  Object.fromEntries(Object.entries(worn).filter(([s]) => s != slot))

// The abilities a weapon or a thing for the other hand gives, and what each
// does.
let gives = (t: Thing) => {
  let ids = t.slot == 'main' || t.slot == 'off'
    ? (GIVES[t.family ?? ''] ?? []).slice(0, t.slot == 'main' ? 2 : 1)
    : []
  return ids.map((id) => {
    let a = ABILITIES[id]
    return `<span class=Pack_Ability><i>${a.icon}</i><b>${esc(a.name)}</b> ${
      esc(a.says)
    }</span>`
  }).join('')
}

// A thing's tier, as pips in its tier's colour.
let pips = (t?: Thing) =>
  t?.tier
    ? `<i class="Pack_Tier Pack_Tier-${t.tier}" title="Tier ${t.tier}">${
      '•'.repeat(t.tier)
    }</i>`
    : ''

/** The pack, drawn into its panel (panel.ts). */
export let pack = (panel: Panel, acts: Acts) => {
  let box = panel.body
  // What is picked: a slot worn, a kind in the bag, or a kind on the rack.
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
      if (act == 'wear') {
        let h = s.bag.find((h) =>
          h.kind == key && !Object.values(s.worn).some((w) => w?.eid == h.eid)
        )
        let slot = ITEMS[key]?.slot
        if (h && slot) acts.wear(slot, h.eid)
        picked = slot ? { from: 'worn', key: slot } : null
      }
      if (act == 'take' && from == 'rack') {
        acts.take(key)
        picked = { from: 'worn', key: ITEMS[key]?.slot ?? '' }
      }
    }
    was = []
  })

  // What the hero carries beyond what they wear, a stack for each kind: arms
  // and armour first, the best first, then everything else by name.
  let stacks = (s: Sheet) => {
    let wearing = new Set(Object.values(s.worn).map((w) => w?.eid))
    let by = new Map<string, number>()
    for (let h of s.bag) {
      if (!wearing.has(h.eid)) by.set(h.kind, (by.get(h.kind) ?? 0) + h.n)
    }
    let rank = (k: string) => ITEMS[k]?.slot ? 10 - (ITEMS[k].tier ?? 0) : 20
    return [...by].sort(([a], [b]) =>
      rank(a) - rank(b) ||
      (ITEMS[a]?.name ?? a).localeCompare(ITEMS[b]?.name ?? b)
    )
  }

  let tile = (pick: string, kind: string, n = 1, on = false, had = false) => {
    let t = ITEMS[kind]
    return `<button class="Pack_Tile${on ? ' Pack_Tile-on' : ''}${
      had ? ' Pack_Tile-had' : ''
    }" data-pick="${pick}" title="${esc(t?.name ?? kind)}"><i>${
      icon(kind) || '•'
    }</i>${n > 1 ? `<b>${n}</b>` : ''}${pips(t)}</button>`
  }

  // What a thing is, what wearing it would change, and what can be done.
  let card = (s: Sheet, f: Frame) => {
    if (!picked) {
      return `<p class=Pack_Hint>Tap something to see what it is.</p>`
    }
    let { from, key } = picked
    let kind = from == 'worn' ? s.worn[key as Slot]?.kind ?? '' : key
    let t = ITEMS[kind]
    if (!t) return `<p class=Pack_Hint>Nothing worn there.</p>`
    let now = numbers(s, s.worn)
    let then = from == 'worn'
      ? numbers(s, bare(s.worn, key))
      : numbers(s, trying(s.worn, kind))
    let sort = sortOf(t)
    let hands = HANDLES[t.family ?? '']?.hands == 2 ? ' · both hands' : ''
    let what = t.slot
      ? `${sort}${t.tier ? ` · tier ${t.tier}` : ''}${hands}`
      : t.heals
      ? `Drink it to mend ${t.heals} (Q)`
      : 'Carried'
    // Worn, what taking it off loses; else, what putting it on gains.
    let [a, b] = from == 'worn' ? [then, now] : [now, then]
    let diff = t.slot
      ? LINES.filter(([k]) => a[k] != b[k]).map(([k, mark, say, more]) => {
        let d = Math.round((b[k] - a[k]) * 100) / 100
        let good = more ? d > 0 : d < 0
        let sign = d > 0 ? '+' : '−'
        let shown = k == 'pace' ? `${Math.abs(d).toFixed(2)} s` : Math.abs(d)
        return `<span class=Pack_Num>${glyph(mark)} ${say(b[k])} <em class="${
          good ? 'Pack_Up' : 'Pack_Down'
        }">${sign}${shown}</em></span>`
      }).join('')
      : ''
    let held = s.bag.some((h) => h.kind == kind)
    let act = from == 'worn'
      ? `<button class="Btn Btn-small" data-do=off>Take it off</button>`
      : from == 'rack'
      ? f.rack
        ? held
          ? `<span class=Pack_Hint>You have one.</span>`
          : `<button class="Btn Btn-go Btn-small" data-do=take>Take it</button>`
        : ''
      : t.slot
      ? `<button class="Btn Btn-go Btn-small" data-do=wear>${
        t.slot == 'main' || t.slot == 'off' ? 'Hold it' : 'Wear it'
      }</button>`
      : ''
    let can = gives(t)
    return `<div class=Pack_Card><i class=Pack_Big>${icon(kind)}</i><div><b>${
      esc(t.name)
    }</b><span>${esc(what)}</span></div>${act}</div>${
      can ? `<div class=Pack_Abilities>${can}</div>` : ''
    }${diff ? `<div class=Pack_Nums>${diff}</div>` : ''}`
  }

  let draw = (s: Sheet, f: Frame) => {
    let n = numbers(s, s.worn)
    let worn = SLOTS.map((slot) => {
      let h = s.worn[slot], t = h && ITEMS[h.kind]
      let on = picked?.from == 'worn' && picked.key == slot
      return `<button class="Pack_Slot${on ? ' Pack_Tile-on' : ''}${
        t ? '' : ' Pack_Slot-empty'
      }" data-pick="worn:${slot}"><small>${SLOT_NAMES[slot]}</small><i>${
        h ? icon(h.kind) : '·'
      }</i><span>${
        esc(t?.name ?? (slot == 'main' ? 'Bare hands' : 'Nothing'))
      }</span>${pips(t)}</button>`
    }).join('')
    let stats = LINES.filter(([k]) => k != 'speed' || n.speed).map((
      [k, mark, say],
    ) => `<span class=Pack_Num>${glyph(mark)} ${say(n[k])}</span>`).join('') +
      s.abilities.map((id, i) =>
        ABILITIES[id]
          ? `<span class=Pack_Num><kbd class=Key>${i + 1}</kbd> ${
            ABILITIES[id].icon
          } ${esc(ABILITIES[id].name)}</span>`
          : ''
      ).join('')
    let bag = stacks(s).map(([k, count]) =>
      tile(
        `bag:${k}`,
        k,
        count,
        picked?.from == 'bag' && picked.key == k,
      )
    ).join('')
    let rack = f.rack
      ? `<h3 class=Pack_Head>By the fire: plain arms for anyone to try</h3><div class=Pack_Grid>${
        RACK.map((k) =>
          tile(
            `rack:${k}`,
            k,
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
      `<div class=Pack_Pick>${card(s, f)}</div>` +
      `<h3 class=Pack_Head>In your bag</h3>` +
      `<div class=Pack_Grid>${
        bag || '<span class=Pack_Hint>Your bag is empty.</span>'
      }</div>${rack}</div>`
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
