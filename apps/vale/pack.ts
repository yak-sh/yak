// The hero's pack, drawn into their panel's Bag tab: what they wear in each
// slot (how they fight in it is the Character tab's), everything else they
// carry, and by a village's fire, the rack of plain arms anyone may take
// to try, each a grid of squares (kit/ValeGrid.ts), as a bag in a good game
// is. Each piece of gear is its own, its picture framed in its rarity's
// colour (rarity.ts) with its tier in a corner, or in red the level it needs,
// faded until the hero has it; everything else is a stack of its kind, how
// many in a corner. A piece's tip sets it beside what is worn in its place
// (compare.ts `versus`). Tap a thing to see, below the worn slots in the
// right pane, its stats, abilities, and what wearing it would change, then
// wear it, take it off, or take it from the rack, or double-tap a piece to
// wear it; a second dagger, for a hero who knows how, shows what it would
// change in the other hand. B or the tray's bag opens it. It is written
// again only when what it shows changed.
import { type ComponentChildren, h as el } from 'preact'
import { Button, Rows, Tile } from '@yaks/ui'
import { type Doer, does, GIVES, OFF } from './abilities.ts'
import { HANDLES, type Slot, SLOT_NAMES, SLOTS, tierName } from './arms.ts'
import {
  bare,
  changes,
  doer,
  into,
  itemStats,
  numbers,
  pieceTile,
  solo,
  sortLine,
  stats,
  trying,
  versus,
} from './compare.ts'
import { canWear, rack as rackKinds } from './gear.ts'
import { glyph } from './glyphs.ts'
import { ITEMS, type Thing } from './items.ts'
import { ValeGrid } from './kit/ValeGrid.ts'
import { type Piece, piece, RARITIES, tint } from './rarity.ts'
import { icon } from './sprites.ts'
import type { Page } from './panel.ts'
import type { Frame, Sheet } from './play.ts'
import type { Held } from './rules.ts'
import { formOf } from './skills.ts'
import { cards, heard, type Tip, tipProps } from './tip.ts'
import { hint, mark, part, picture } from './tile.ts'
import { split } from './ui/split.ts'

let { Cell, Picture, Label, Name, Tier, Need, Count } = ValeGrid

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
        el(
          Tile,
          { key: id },
          picture(glyph(a.icon)),
          el(Tile.Title, {}, a.name),
          el(Tile.Sub, {}, does(a, d)),
        ),
      ]
      : []
  })
}

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

  let at = (from: From, key: string) =>
    picked?.from == from && picked.key == key

  // A thing in its square (kit/ValeGrid.ts), picked from `from` by `key`,
  // framed in its rarity, a legendary's alight; `mod` says how else it
  // stands.
  let cell = (
    from: From,
    key: string,
    p: Piece | undefined,
    mod: (string | false)[],
    props: Record<string, string>,
    ...kids: ComponentChildren[]
  ) =>
    el(
      Cell,
      {
        key,
        class: tint(p?.rarity),
        mod: [
          at(from, key) && 'on',
          p?.rarity == 'legendary' && 'glow',
          ...mod,
        ],
        'data-pick': `${from}:${key}`,
        ...props,
        onClick: pick(from, key),
      },
      ...kids,
    )

  // A thing's picture, or a dot for none, and its tier in a corner.
  let face = (h?: Held, p?: Piece) => [
    el(Picture, {
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: h ? icon(h.kind) || '•' : '·' },
    }),
    p?.tier && el(Tier, { 'aria-hidden': 'true' }, tierName(p.tier)),
  ]

  // A thing carried, or on the rack: how many there are, and in red the
  // level it needs. Its name, and what it is, are its tip's.
  let carry = (from: From, h: Held, n = 1, had = false, locked = false) => {
    let p = piece(h)
    let tip: Tip = {
      name: n > 1 ? `${p.name} ×${n}` : p.name,
      note: locked
        ? `Requires level ${p.lvl}`
        : had
        ? 'You have one'
        : p.slot
        ? sortLine(p)
        : p.heals
        ? `Drink it to mend ${p.heals}`
        : undefined,
    }
    return cell(
      from,
      from == 'rack' ? h.kind : h.eid,
      p,
      [(had || locked) && 'dim'],
      { ...tipProps(tip), 'aria-label': heard(tip) },
      ...face(h, p),
      locked && el(Need, { 'aria-hidden': 'true' }, mark('lock'), p.lvl),
      n > 1 && el(Count, { 'aria-hidden': 'true' }, n),
    )
  }

  // A slot worn: what it is, over what fills it.
  let slot = (s: Sheet, slot: Slot) => {
    let h = s.worn[slot], t = h && piece(h)
    return cell(
      'worn',
      slot,
      t,
      [!t && 'empty'],
      t ? tipProps({ name: t.name, note: sortLine(t) }) : {},
      el(Label, {}, SLOT_NAMES[slot]),
      ...face(h, t),
      el(Name, {}, t?.name ?? (slot == 'main' ? 'Bare hands' : 'Nothing')),
    )
  }

  // What a thing is, what wearing it would change, and what can be done.
  let card = (s: Sheet, f: Pick<Frame, 'rack'>) => {
    if (!picked) return hint('Tap something to see what it is.')
    let { from, key } = picked
    let h = heldAt(s, from, key)
    let t = h && ITEMS[h.kind] && piece(h)
    if (!h || !t) return hint('Nothing worn there.')
    let kind = h.kind
    let slot = from == 'worn' ? key as Slot : into(s, kind)
    let ready = canWear(h, s.lvl)
    let both = HANDLES[t.family ?? '']?.hands == 2 ? ' · both hands' : ''
    let what = t.slot
      ? `${sortLine(t)}${both}`
      : t.heals
      ? `Drink it to mend ${t.heals} (Q)`
      : 'Carried'
    // The rack gives one of each, and a second of a blade for the other hand.
    let held = s.bag.filter((b) => b.kind == kind).length >=
      (slot == t.slot ? 1 : 2)
    let button = (act: string, words: string, go = true) =>
      el(Button, { mod: go && 'go', 'data-do': act }, words)
    let act = from == 'worn'
      ? button('off', 'Take it off', false)
      : from == 'rack'
      ? f.rack ? held ? 'You have one.' : button('take', 'Take it') : null
      : !ready && t.slot
      ? null
      : slot == 'off' && t.slot == 'main'
      ? [button('wear', 'Hold it', false), button('twin', 'Other hand')]
      : t.slot
      ? button(
        'wear',
        t.slot == 'main' || t.slot == 'off' ? 'Hold it' : 'Wear it',
      )
      : null
    let can = gives(
      t,
      slot,
      s.learned,
      doer(s, from == 'worn' ? s.worn : trying(s.worn, h, slot)),
    )
    return [
      pieceTile(
        t,
        { mod: 'head' },
        el(Tile.Sub, {}, what),
        !ready && t.slot &&
          el(Tile.Sub, { mod: 'negative' }, `Requires level ${t.lvl}`),
        act && el(Tile.End, {}, act),
      ),
      t.slot && part('Item stats', stats(itemStats(t))),
      can.length > 0 && part('Abilities', el(Rows, {}, can)),
      // The hero before and after what this card offers.
      t.slot && changes(
        from == 'worn' ? 'If removed' : 'If equipped',
        numbers(s, s.worn),
        numbers(
          s,
          from == 'worn' ? bare(s.worn, key) : trying(s.worn, h, slot),
        ),
      ),
    ]
  }

  let draw = (s: Sheet, f: Pick<Frame, 'rack'>) => {
    let bag = carried(s).map(({ h, n }) =>
      carry('bag', h, n, false, !!ITEMS[h.kind]?.slot && !canWear(h, s.lvl))
    )
    panes.render(
      el(
        'div',
        { class: 'Pack' },
        part(
          'In your bag',
          bag.length ? el(ValeGrid, {}, bag) : hint('Your bag is empty.'),
        ),
        f.rack && part(
          'By the fire: plain arms for anyone to try',
          el(
            ValeGrid,
            {},
            rackKinds().map((k) =>
              carry(
                'rack',
                { eid: k, kind: k, n: 1 },
                1,
                s.bag.some((h) => h.kind == k),
              )
            ),
          ),
        ),
      ),
      [
        el(ValeGrid, { mod: 'wide' }, SLOTS.map((sl) => slot(s, sl))),
        card(s, f),
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
