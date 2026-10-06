// The station menu shared by the village bench and the Trades guide. Its
// selection lives in the page graph; the guide omits every work action.
import { type ComponentChildren, h, render } from 'preact'
import { Button, Rows, Section, Tabs, Tile } from '@yaks/ui'
import {
  able,
  have,
  plan,
  type Recipe,
  recipes,
  serves,
  spare,
  STATIONS,
  STUFF,
  stuffName,
} from './craft.ts'
import { SLOTS, sortOf, tierName, tierRange } from './arms.ts'
import {
  into,
  pieceTile,
  type Side,
  sortLine,
  statLine,
  statRangeValue,
  stats,
  statStep,
  step,
  stepRange,
  trying,
} from './compare.ts'
import { glyphText } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Panel } from './panel.ts'
import { type PageState, pageState } from './page-state.ts'
import {
  GEAR_STATS,
  piece,
  RARITIES,
  statRange,
  tint,
  upgradeRange,
} from './rarity.ts'
import type { Held } from './rules.ts'
import { icon } from './sprites.ts'
import type { Sheet } from './play.ts'
import { hint, mark, part, picture as plate } from './tile.ts'
import { cards, tipProps } from './tip.ts'
import { type Craft, least, tradeNeed, TRADES, type Trades } from './trades.ts'
import { madeBy, MOST, upgradeOf } from './upgrade.ts'
import type { Job } from './work.ts'

export type Acts = {
  make: (recipe: string) => void
  upgrade: (piece: string) => void
}
export type StationState = { state: PageState; owner: string }
let tiers = (c: Craft) =>
  [
    ...new Set(
      Object.values(recipes()).filter((r) => r.at == c).map((r) => r.tier),
    ),
  ].sort((a, b) => a - b)
let pieces = (s: Sheet, c: Craft): Held[] => {
  let worn = SLOTS.flatMap((slot) => s.worn[slot] ?? [])
  let rest = s.bag.filter((held) =>
    ITEMS[held.kind]?.slot && !worn.some((w) => w.eid == held.eid)
  ).sort((a, b) =>
    RARITIES.indexOf(b.rarity ?? 'common') -
      RARITIES.indexOf(a.rarity ?? 'common') ||
    (ITEMS[b.kind].tier ?? 0) - (ITEMS[a.kind].tier ?? 0)
  )
  return [...worn, ...rest].filter((held) => madeBy(held.kind)?.at == c)
}
let wearing = (s: Sheet, held: Held, x: Held) => {
  let slot = SLOTS.find((sl) => s.worn[sl]?.eid == held.eid)
  return trying(slot ? s.worn : trying(s.worn, held), x, slot)
}
// What upgrading `held` once may make of it: it now, and at the least and
// the most, each worn as the hero would wear it.
let ahead = (s: Sheet, held: Held): [Side, Side, Side] | undefined => {
  let [lo, hi] = upgradeRange(held)
  let side = (label: string, x: Partial<Held>) => ({
    label,
    p: piece({ ...held, ...x }),
    worn: wearing(s, held, { ...held, ...x }),
  })
  return upgradeOf(held.kind, held.plus ?? 0)
    ? [side('Now', {}), side('Least', lo), side('Most', hi)]
    : undefined
}
// What a thing to make or upgrade asks, a stuff to a tile: what of it the
// bag holds out of what is asked, short of it in red.
let needs = (bag: Sheet['bag'], r: Recipe) =>
  part(
    'Needs',
    h(
      Rows,
      {},
      r.needs.map(([what, n]) => {
        let got = have(bag, what, r.tier), kinds = serves(what, r.tier)
        let name = (kind: string) => ITEMS[kind]?.name ?? kind
        let names = kinds.length < 2
          ? ''
          : STUFF[what]?.tiered
          ? `${name(kinds[0])} or better`
          : `${kinds.slice(0, -1).map(name).join(', ')} or ${
            name(kinds[kinds.length - 1])
          }`
        let shown = kinds.find((kind) => bag.some((x) => x.kind == kind)) ??
          kinds[0]
        return h(
          Tile,
          { key: what, 'data-need': what },
          plate(icon(shown) || '•'),
          h(Tile.Title, {}, stuffName(what)),
          names && h(Tile.Sub, {}, names),
          h(Tile.End, { mod: got < n && 'negative' }, `${got} / ${n}`),
        )
      }),
    ),
  )
// What a piece made of `kind` may roll, each stat from what the piece worn
// in its place has to what it may become.
let makingRange = (s: Sheet, kind: string) => {
  let item = ITEMS[kind]
  if (!item?.slot || !item.tier) return null
  let [lo, hi] = tierRange(item.tier), values = statRange(kind)
  let slot = into(s, kind), held = slot && s.worn[slot]
  let worn = held ? piece(held) : undefined
  return h(
    Section,
    { 'data-ranges': '' },
    h(
      Section.Title,
      {},
      'Possible stats',
      h(Section.Note, {}, `Level ${lo}–${hi} · Common–Legendary`),
    ),
    worn && h(Section.Sub, {}, `Against your ${worn.name}`),
    stats(GEAR_STATS.flatMap((stat) => {
      let pair = values[stat]
      return !pair
        ? []
        : worn
        ? [statStep(stat, worn[stat] ?? 0, ...pair)]
        : [statLine(stat, statRangeValue(stat, ...pair))]
    })),
  )
}

/** One menu, with work available only when its host supplies actions. */
export let menu = (
  c: Craft,
  s: Sheet,
  job: Job,
  { state, owner }: StationState,
  change: () => void,
  acts?: Acts,
) => {
  let tab = state.cursor(`${owner}/tier`) ??
    String(
      Math.max(1, ...tiers(c).filter((n) => job.trades[c].lvl >= least(n))),
    )
  let up = tab == 'up', picked = state.cursor(`${owner}/item`)
  let bag = spare(s.bag, Object.values(s.worn)),
    mine = job.trades[c],
    trade = TRADES[c]
  let select = (key: string) => {
    state.select(`${owner}/item`, key)
    change()
  }
  let switchTier = (key: string) => {
    state.select(`${owner}/tier`, key)
    state.select(`${owner}/item`, null)
    change()
  }
  let waits = (
    r: Recipe,
  ): [string, boolean] => [`Requires ${trade.name} ${least(r.tier)}`, true]
  let work = (
    r: Recipe,
    key: string,
    words: string,
    kind: 'make' | 'upgrade',
  ): ComponentChildren => {
    if (!able(r, mine.lvl) || !acts) return null
    let active = kind == 'make'
      ? job.doing?.recipe == key && !job.doing.piece
      : job.doing?.piece == key
    return h(Button, {
      mod: 'go',
      class: active ? 'Craft_Go' : undefined,
      'data-do': kind,
      disabled: active || !plan(r, bag),
      style: active ? { '--k': job.doing!.k.toFixed(3) } : undefined,
      onClick: () => {
        if (plan(r, bag) && !active) acts[kind](key)
      },
    }, active ? `${kind == 'make' ? STATIONS[c].doing : 'Upgrading'}…` : words)
  }
  // The trade level a recipe waits on, where the hero has not reached it.
  let shut = (r?: Recipe) =>
    r && !able(r, mine.lvl) &&
    h(Tile.Sub, { mod: 'negative' }, waits(r)[0])
  let detail: ComponentChildren = hint(
    up
      ? 'Tap something you carry to upgrade it.'
      : 'Tap something to see what it needs.',
  )
  if (up) {
    let held = pieces(s, c).find((held) => held.eid == picked)
    if (held) {
      let item = piece(held),
        plus = held.plus ?? 0,
        r = upgradeOf(held.kind, plus),
        range = ahead(s, held)
      detail = [
        pieceTile(
          item,
          { mod: 'head' },
          h(Tile.Sub, {}, `${sortLine(item)} · +${plus} of ${MOST}`),
          r ? shut(r) : h(Tile.Sub, {}, 'As fine as it gets.'),
          r && h(
            Tile.End,
            {},
            work(r, held.eid, `Upgrade to +${plus + 1}`, 'upgrade'),
          ),
        ),
        r && needs(bag, r),
        range && stepRange(s, ...range),
      ]
    }
  } else {
    let r = picked ? recipes()[picked] : undefined
    if (r && r.at == c && String(r.tier) == tab) {
      let item = ITEMS[r.makes]
      detail = [
        h(
          Tile,
          { mod: 'head' },
          plate(icon(r.makes) || '•'),
          h(Tile.Title, {}, item?.name ?? r.makes),
          item && h(
            Tile.Sub,
            {},
            item.heals
              ? `Drink it to mend ${item.heals} (Q)`
              : `${sortOf(item)} · tier ${tierName(r.tier)}`,
          ),
          shut(r),
          h(Tile.End, {}, work(r, r.makes, STATIONS[c].verb, 'make')),
        ),
        needs(bag, r),
        makingRange(s, r.makes),
      ]
    }
  }
  // A thing to make, or a piece to upgrade: its picture, its name, what it
  // is or the trade level it waits on, faded while it cannot be done now.
  let tile = (
    key: string,
    kind: string,
    name: string,
    rarity: string,
    ready: boolean,
    sub: [string, boolean?],
    plus = 0,
  ) =>
    h(
      Tile,
      {
        key,
        mod: [picked == key && 'on', !ready && 'dim'],
        'data-pick': key,
        ...(up ? tipProps({ name }) : {}),
        onClick: () => select(key),
      },
      plate(icon(kind) || '•', { class: rarity }),
      h(Tile.Title, { class: rarity && `Rarity ${rarity}` }, name),
      sub[0] && h(Tile.Sub, { mod: sub[1] && 'negative' }, sub[0]),
      plus ? h(Tile.End, {}, `+${plus}`) : null,
    )
  let tiles = up
    ? pieces(s, c).map((held) => {
      let item = piece(held), r = upgradeOf(held.kind, held.plus ?? 0)
      return tile(
        held.eid,
        held.kind,
        item.name,
        tint(item.rarity),
        !!r && able(r, mine.lvl),
        !r
          ? ['As fine as it gets']
          : able(r, mine.lvl)
          ? [sortLine(item)]
          : waits(r),
        held.plus,
      )
    })
    : Object.values(recipes()).filter((r) => r.at == c && String(r.tier) == tab)
      .map((r) => {
        let item = ITEMS[r.makes]
        return tile(
          r.makes,
          r.makes,
          item?.name ?? r.makes,
          '',
          able(r, mine.lvl) && !!plan(r, bag),
          !able(r, mine.lvl)
            ? waits(r)
            : [item?.heals ? `Mends ${item.heals}` : item ? sortOf(item) : ''],
        )
      })
  return h(
    'div',
    { class: 'Craft_Menu' },
    h(
      'div',
      { class: 'Pack Craft' },
      h(
        Tabs,
        { class: 'Craft_Tiers' },
        tiers(c).map((tier) =>
          h(
            Tabs.Tab,
            {
              key: tier,
              type: 'button',
              mod: tab == String(tier) && 'on',
              'data-tier': tier,
              'aria-pressed': tab == String(tier),
              onClick: () => switchTier(String(tier)),
            },
            mine.lvl < least(tier) ? mark('lock') : null,
            tierName(tier),
          )
        ),
        Object.values(recipes()).some((r) =>
          r.at == c && ITEMS[r.makes]?.slot
        ) &&
          h(
            Tabs.Tab,
            {
              type: 'button',
              mod: up && 'on',
              class: 'Craft_Up',
              'data-tier': 'up',
              'aria-pressed': up,
              onClick: () => switchTier('up'),
            },
            mark('sparkles'),
            'Upgrade',
          ),
      ),
      tiles.length
        ? h(Rows, {}, tiles)
        : hint('Nothing you carry is upgraded here.'),
    ),
    h('div', { class: 'Craft_Detail' }, detail),
  )
}

/** The village station host; Trades uses the same menu without actions. */
export let station = (
  panel: Panel,
  acts: Acts,
  state: PageState = pageState(),
  owner = 'station',
) => {
  let sheet: Sheet | null = null,
    latest: Job | null = null,
    was: unknown[] = []
  let current = () => state.cursor(`${owner}/at`) as Craft | undefined
  let draw = () => {
    let c = current()
    if (!panel.open || !c || !sheet || !latest) return
    let mine = latest.trades[c], trade = TRADES[c]
    panel.head(
      `${STATIONS[c].name} <span class=Badge>${
        glyphText(trade.icon)
      } ${trade.name} ${mine.lvl}</span><small class=Panel_Note>${mine.xp} / ${
        tradeNeed(mine.lvl + 1)
      } xp</small>`,
    )
    render(menu(c, sheet, latest, { state, owner }, draw, acts), panel.body)
  }
  cards(panel.body, (e) => {
    let held = state.cursor(`${owner}/tier`) == 'up'
      ? sheet?.bag.find((held) => held.eid == e.getAttribute('data-pick'))
      : null
    let range = sheet && held && ahead(sheet, held)
    return range ? step(sheet!, ...range) : undefined
  })
  return {
    get at() {
      return panel.open ? current() ?? null : null
    },
    open: (c: Craft, trades: Trades) => {
      state.select(`${owner}/at`, c)
      state.select(
        `${owner}/tier`,
        String(
          Math.max(1, ...tiers(c).filter((n) => trades[c].lvl >= least(n))),
        ),
      )
      state.select(`${owner}/item`, null)
      panel.show()
      was = []
      draw()
    },
    close: panel.close,
    show: (s: Sheet, job: Job) => {
      sheet = s
      latest = job
      let key = [s, job.trades, job.doing?.k.toFixed(2), current(), ITEMS]
      if (key.every((v, i) => v === was[i])) return
      was = key
      draw()
    },
  }
}
