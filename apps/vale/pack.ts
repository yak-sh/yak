// The hero's pack, drawn into their panel's Bag tab: what they wear in each
// slot (how they fight in it is the Character tab's), everything else they
// carry, and by a village's fire, the rack of plain arms anyone may take
// to try, each a list, one thing to a row. Each piece of gear is its own,
// framed and named in its rarity's colour (rarity.ts), saying its level and
// kind, or in red the level it needs, faded until the hero has it; everything
// else is a stack of its kind. A piece's tip sets it beside what is worn in
// its place (compare.ts `versus`). Tap a thing, or double-tap a piece to wear
// it,
// to see, below the worn slots in the right pane, its stats, abilities, and
// what wearing it would change, then wear it, take it off, or take
// it from the rack; a second dagger, for a hero who knows how, shows what it
// would change in the other hand. B or the tray's bag opens it. It is written
// again only when what it shows changed.
import { h as el } from 'preact'
import { Rows, Tile } from '@yaks/ui'
import { type Doer, does, GIVES, OFF } from './abilities.ts'
import { HANDLES, type Slot, SLOT_NAMES, SLOTS, tierName } from './arms.ts'
import {
  bare,
  doer,
  into,
  itemStats,
  moved,
  numbers,
  solo,
  sortLine,
  trying,
  versus,
} from './compare.ts'
import { canWear, rack as rackKinds } from './gear.ts'
import { glyphText } from './glyphs.ts'
import { ITEMS, type Thing } from './items.ts'
import { piece, RARITIES, tint } from './rarity.ts'
import { icon } from './sprites.ts'
import type { Page } from './panel.ts'
import type { Frame, Sheet } from './play.ts'
import type { Held } from './rules.ts'
import { formOf } from './skills.ts'
import { cards, tipProps } from './tip.ts'
import { picture } from './tile.ts'
import { split } from './ui/split.ts'

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

// A thing's tier, beside its picture.
let tier = (t?: Thing) =>
  t?.tier
    ? `<span class=Pack_Tier aria-hidden=true>${tierName(t.tier)}</span>`
    : ''

// Where a thing picked is: a slot worn, a row in the bag, or a kind on the
// rack.
type From = 'worn' | 'bag' | 'rack'

// The thing picked from `from` by `key`, if it is there.
let heldAt = (s: Sheet, from: From, key: string): Held | undefined => {
  let slot = SLOTS.find((sl) => sl == key)
  return from == 'worn'
    ? slot && s.worn[slot]
    : from == 'bag'
    ? s.bag.find((h) => h.eid == key)
    : { eid: key, kind: key, n: 1 }
}

// What a piece's tip shows: worn, the piece; else, the piece beside what is
// worn in its place. Nothing for what is not worn.
let against = (s: Sheet, from: From, key: string) => {
  let h = heldAt(s, from, key)
  let slot = h && into(s, h.kind), w = slot && s.worn[slot]
  return !h || !slot
    ? undefined
    : from == 'worn'
    ? solo('Worn', piece(h))
    : versus(
      s,
      {
        label: from == 'rack' ? 'By the fire' : 'In your bag',
        p: piece(h),
        worn: trying(s.worn, h, slot),
      },
      { label: 'Worn', p: w ? piece(w) : undefined, worn: s.worn },
    )
}

/** What the hero carries beyond what they wear: gear by item level, rarity,
 * then name; other things stacked by kind and sorted by name. */
export let carried = (s: Pick<Sheet, 'bag' | 'worn'>) => {
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
  let byName = (a: { h: Held }, b: { h: Held }) =>
    piece(a.h).name.localeCompare(piece(b.h).name)
  let byGear = (a: { h: Held }, b: { h: Held }) => {
    let x = piece(a.h), y = piece(b.h)
    return (y.lvl ?? 0) - (x.lvl ?? 0) ||
      RARITIES.indexOf(y.rarity) - RARITIES.indexOf(x.rarity) ||
      byName(a, b)
  }
  return [...gear.sort(byGear), ...[...stacks.values()].sort(byName)]
}

/** The pack, drawn into its tab (panel.ts). */
export let pack = (panel: Page, acts: Acts) => {
  let box = panel.body
  let panes = split(box)
  // What is picked.
  let picked: { from: From; key: string } | null = null
  let sheet: Sheet | null = null
  let was: unknown[] = []
  // Every equip gesture uses the same admission as the hero's wear command.
  let equip = (s: Sheet, key: string, slot?: Slot) => {
    let h = s.bag.find((h) => h.eid == key)
    slot ??= h && into(s, h.kind)
    if (!h || !slot || !canWear(h, s.lvl)) return
    acts.wear(slot, h.eid)
    picked = { from: 'worn', key: slot }
  }
  box.addEventListener('dblclick', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let pick = t?.closest<HTMLElement>('[data-pick]')?.dataset.pick
    if (!sheet || !pick?.startsWith('bag:')) return
    equip(sheet, pick.slice(4))
    was = []
  })
  let pick = (from: From, key: string) => () => {
    picked = { from, key }
    was = []
  }
  box.addEventListener('click', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let s = sheet
    let act = t?.closest<HTMLElement>('[data-do]')?.dataset.do
    if (act && s && picked) {
      let { from, key } = picked
      if (act == 'off') acts.wear(key as Slot)
      if (act == 'wear' || act == 'twin') {
        let h = s.bag.find((h) => h.eid == key)
        equip(s, key, act == 'twin' ? 'off' : ITEMS[h?.kind ?? '']?.slot)
      }
      if (act == 'take' && from == 'rack') {
        acts.take(key)
        picked = { from: 'worn', key: into(s, key) ?? '' }
      }
    }
    was = []
  })
  cards(box, (e) => {
    let [from, key] = e.getAttribute('data-pick')?.split(':') ?? []
    return sheet && (from == 'worn' || from == 'bag' || from == 'rack')
      ? against(sheet, from, key)
      : undefined
  })

  // A thing carried, or on the rack: its picture framed in its rarity, its
  // name, and its level and kind, or the level it needs.
  let row = (
    from: From,
    h: Held,
    n = 1,
    on = false,
    had = false,
    locked = false,
  ) => {
    let p = piece(h), key = from == 'rack' ? h.kind : h.eid
    let what = locked
      ? `Requires level ${p.lvl}`
      : had
      ? 'You have one'
      : p.slot
      ? sortLine(p)
      : p.heals
      ? `Drink it to mend ${p.heals}`
      : ''
    return el(
      Tile,
      {
        key,
        mod: [on && 'on', (had || locked) && 'dim'],
        'data-pick': `${from}:${key}`,
        ...tipProps({ name: p.name }),
        onClick: pick(from, key),
      },
      picture(icon(h.kind) || '•', { class: tint(p.rarity) }),
      el(Tile.Title, { class: `Rarity ${tint(p.rarity)}` }, p.name),
      what && el(Tile.Sub, { mod: locked && 'negative' }, what),
      n > 1 ? el(Tile.End, {}, `×${n}`) : null,
    )
  }

  // A slot worn, as a piece of gear framed in its rarity.
  let slot = (s: Sheet, slot: Slot) => {
    let h = s.worn[slot], t = h && piece(h)
    return el(
      'button',
      {
        key: slot,
        type: 'button',
        class: `Pack_Slot ${tint(t?.rarity)}${t ? '' : ' Pack_Slot-empty'}`,
        'data-pick': `worn:${slot}`,
        'aria-current': picked?.from == 'worn' && picked.key == slot,
        ...(t ? tipProps({ name: t.name, note: sortLine(t) }) : {}),
        onClick: pick('worn', slot),
      },
      el('small', {}, SLOT_NAMES[slot]),
      el('i', {
        dangerouslySetInnerHTML: {
          __html: (h ? icon(h.kind) : '·') + tier(t),
        },
      }),
      el(
        'span',
        { class: 'Rarity' },
        t?.name ?? (slot == 'main' ? 'Bare hands' : 'Nothing'),
      ),
    )
  }

  // What a thing is, what wearing it would change, and what can be done.
  let card = (s: Sheet, f: Pick<Frame, 'rack'>) => {
    if (!picked) {
      return `<p class=Pack_Hint>Tap something to see what it is.</p>`
    }
    let { from, key } = picked
    let h = heldAt(s, from, key)
    let t = h && ITEMS[h.kind] && piece(h)
    if (!h || !t) return `<p class=Pack_Hint>Nothing worn there.</p>`
    let kind = h.kind
    let slot = from == 'worn' ? key as Slot : into(s, kind)
    let ready = canWear(h, s.lvl)
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
    // Compare the hero before and after the action offered on this card.
    let changes = !t.slot ? '' : moved(now, then)
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
      : !ready && t.slot
      ? `<span class=Pack_Requirement>Requires level ${t.lvl}</span>`
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
    let stats = t.slot ? itemStats(t) : ''
    return `<div class=Pack_Card><i class="Pack_Big ${tint(t.rarity)}">${
      icon(kind)
    }</i><div><b class="Rarity ${tint(t.rarity)}">${esc(t.name)}</b><span>${
      esc(what)
    }</span></div>${act}</div>${
      stats
        ? `<small class=Compare_Label>Item stats</small><div class="Pack_Rolled Rarity ${
          tint(t.rarity)
        }">${stats}</div>`
        : ''
    }${can ? `<div class=Pack_Abilities>${can}</div>` : ''}${
      t.slot
        ? `<small class=Compare_Label>${
          from == 'worn' ? 'If removed' : 'If equipped'
        }</small><div class=Pack_Nums>${
          changes || '<span class=Pack_Hint>No listed stats change.</span>'
        }</div>`
        : ''
    }`
  }

  let draw = (s: Sheet, f: Pick<Frame, 'rack'>) => {
    let at = (from: From, key: string) =>
      picked?.from == from && picked.key == key
    let bag = carried(s).map(({ h, n }) =>
      row(
        'bag',
        h,
        n,
        at('bag', h.eid),
        false,
        !!ITEMS[h.kind]?.slot && !canWear(h, s.lvl),
      )
    )
    panes.render(
      el(
        'div',
        { class: 'Pack' },
        el('h3', { class: 'Pack_Head' }, 'In your bag'),
        bag.length
          ? el(Rows, {}, bag)
          : el('span', { class: 'Pack_Hint' }, 'Your bag is empty.'),
        f.rack && [
          el(
            'h3',
            { class: 'Pack_Head' },
            'By the fire: plain arms for anyone to try',
          ),
          el(
            Rows,
            {},
            rackKinds().map((k) =>
              row(
                'rack',
                { eid: k, kind: k, n: 1 },
                1,
                at('rack', k),
                s.bag.some((h) => h.kind == k),
              )
            ),
          ),
        ],
      ),
      [
        el('div', { class: 'Pack_Worn' }, SLOTS.map((sl) => slot(s, sl))),
        el('div', {
          class: 'Pack_Detail',
          dangerouslySetInnerHTML: { __html: card(s, f) },
        }),
      ],
      picked ? `${picked.from}:${picked.key}` : null,
    )
  }

  return {
    /** show this frame's sheet, when the pack is open and it changed; what
     * was picked is let go once it folds away */
    show: (f: Pick<Frame, 'sheet' | 'rack'>) => {
      sheet = f.sheet
      if (!panel.open) {
        picked = null
        was = []
        return
      }
      let key = [f.sheet, f.rack, picked, ITEMS]
      if (key.every((k, i) => k === was[i])) return
      was = key
      draw(f.sheet, f)
    },
  }
}
