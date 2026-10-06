// The station menu shared by the village bench and the Trades guide. Its
// selection lives in the page graph; the guide omits every work action.
import { type ComponentChildren, h, render } from 'preact'
import { Button, Rows, Tabs, Tile } from '@yaks/ui'
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
  sortLine,
  statLine,
  statRangeValue,
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
import { picture as plate } from './tile.ts'
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
let picture = (kind: string, className?: string) =>
  h('i', {
    class: className,
    dangerouslySetInnerHTML: { __html: icon(kind) || '•' },
  })
let hint = (words: string) => h('p', { class: 'Pack_Hint' }, words)
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
let ahead = (s: Sheet, held: Held) => {
  let [lo, hi] = upgradeRange(held)
  return upgradeOf(held.kind, held.plus ?? 0)
    ? stepRange(s, {
      label: 'Now',
      p: piece(held),
      worn: wearing(s, held, held),
    }, {
      label: 'Least',
      p: piece(lo),
      worn: wearing(s, held, { ...held, ...lo }),
    }, {
      label: 'Most',
      p: piece(hi),
      worn: wearing(s, held, { ...held, ...hi }),
    })
    : undefined
}
let need = (bag: Sheet['bag'], r: Recipe, [what, n]: [string, number]) => {
  let got = have(bag, what, r.tier), kinds = serves(what, r.tier)
  let name = (kind: string) => ITEMS[kind]?.name ?? kind
  let names = kinds.length < 2
    ? ''
    : STUFF[what]?.tiered
    ? `${name(kinds[0])} or better`
    : `${kinds.slice(0, -1).map(name).join(', ')} or ${
      name(kinds[kinds.length - 1])
    }`
  return h(
    'span',
    { class: `Craft_Need${got < n ? ' Craft_Need-short' : ''}` },
    picture(
      kinds.find((kind) => bag.some((held) => held.kind == kind)) ?? kinds[0],
    ),
    h('b', {}, stuffName(what)),
    h('em', {}, `${got} / ${n}`),
    names && h('small', {}, names),
  )
}
let makingRange = (kind: string) => {
  let item = ITEMS[kind]
  if (!item?.slot || !item.tier) return null
  let [lo, hi] = tierRange(item.tier), values = statRange(kind)
  return h(
    'div',
    { class: 'Craft_Ranges' },
    h(
      'small',
      {},
      `Possible per-stat ranges · Level ${lo}–${hi} · Common–Legendary`,
    ),
    GEAR_STATS.flatMap((stat) => {
      let pair = values[stat]
      if (!pair) return []
      return [h('div', {
        dangerouslySetInnerHTML: {
          __html: statLine(stat, statRangeValue(stat, ...pair)),
        },
      })]
    }),
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
  let work = (
    r: Recipe,
    key: string,
    words: string,
    kind: 'make' | 'upgrade',
  ): ComponentChildren => {
    if (!able(r, mine.lvl)) {
      return h(
        'span',
        { class: 'Pack_Hint' },
        `Requires ${trade.name} ${least(r.tier)}`,
      )
    }
    if (!acts) return null
    let active = kind == 'make'
      ? job.doing?.recipe == key && !job.doing.piece
      : job.doing?.piece == key
    return h(Button, {
      class: `Btn Btn-go${active ? ' Craft_Go' : ''}`,
      'data-do': kind,
      disabled: active || !plan(r, bag),
      style: active ? { '--k': job.doing!.k.toFixed(3) } : undefined,
      onClick: () => {
        if (plan(r, bag) && !active) acts[kind](key)
      },
    }, active ? `${kind == 'make' ? STATIONS[c].doing : 'Upgrading'}…` : words)
  }
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
        h(
          'div',
          { class: 'Pack_Card' },
          picture(held.kind, `Pack_Big ${tint(item.rarity)}`),
          h(
            'div',
            {},
            h('b', { class: `Rarity ${tint(item.rarity)}` }, item.name),
            h('span', {}, `${sortLine(item)} · +${plus} of ${MOST}`),
          ),
          r
            ? work(r, held.eid, `Upgrade to +${plus + 1}`, 'upgrade')
            : hint('As fine as it gets.'),
        ),
        r &&
        h(
          'div',
          { class: 'Craft_Needs' },
          r.needs.map((n) => need(bag, r, n)),
        ),
        range && h('div', { dangerouslySetInnerHTML: { __html: range } }),
      ]
    }
  } else {
    let r = picked ? recipes()[picked] : undefined
    if (r && r.at == c && String(r.tier) == tab) {
      let item = ITEMS[r.makes]
      detail = [
        h(
          'div',
          { class: 'Pack_Card' },
          picture(r.makes, 'Pack_Big'),
          h(
            'div',
            {},
            h('b', {}, item?.name ?? r.makes),
            h(
              'span',
              {},
              !item
                ? ''
                : item.heals
                ? `Drink it to mend ${item.heals} (Q)`
                : `${sortOf(item)} · tier ${tierName(r.tier)}`,
            ),
          ),
          work(r, r.makes, STATIONS[c].verb, 'make'),
        ),
        h('div', { class: 'Craft_Needs' }, r.needs.map((n) => need(bag, r, n))),
        makingRange(r.makes),
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
  let waits = (
    r: Recipe,
  ): [string, boolean] => [`Requires ${trade.name} ${least(r.tier)}`, true]
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
            mine.lvl < least(tier)
              ? h('span', {
                dangerouslySetInnerHTML: { __html: glyphText('lock') },
              })
              : null,
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
            h('span', {
              dangerouslySetInnerHTML: { __html: glyphText('sparkles') },
            }),
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
    return sheet && held ? ahead(sheet, held) : undefined
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
