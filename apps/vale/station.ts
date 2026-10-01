// A village's station (craft.ts), drawn into the crafting panel (panel.ts):
// what can be made there, a tier at a time, what each thing asks and how much
// of it the bag holds, and the button that makes it, filling while the hero
// works. Tap a thing to see what it asks. Beside the tiers, the pieces the
// hero carries that the station upgrades (upgrade.ts): what the next step
// asks, and the current-to-possible-result ranges on its card and tip
// (compare.ts `stepRange`). It opens when the hero works the
// station (E, G, or the button), and folds away as any panel does, or when the
// hero walks off. It is written again only when what it shows changed.
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
import { sortLine, statName, statValue, stepRange, trying } from './compare.ts'
import { glyphText } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Panel } from './panel.ts'
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
import { cards, tipped } from './tip.ts'
import { type Craft, least, tradeNeed, TRADES, type Trades } from './trades.ts'
import { madeBy, MOST, upgradeOf } from './upgrade.ts'
import { split } from './ui/split.ts'
import type { Job } from './work.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export type Acts = {
  make: (recipe: string) => void
  upgrade: (piece: string) => void
}

/** The station's sheet, in its `panel`, until a station is worked. */
export let station = (panel: Panel, acts: Acts) => {
  let box = panel.body
  let panes = split(box)
  let at: Craft | null = null
  let tier = 1
  // Upgrading rather than making; what is picked is then a piece's row.
  let up = false
  let picked: string | null = null
  let sheet: Sheet | null = null
  let was: unknown[] = []
  box.addEventListener('click', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let pick = t?.closest<HTMLElement>('[data-pick]')?.dataset.pick
    let tab = t?.closest<HTMLElement>('[data-tier]')?.dataset.tier
    let act = t?.closest<HTMLElement>('[data-do]')?.dataset.do
    if (tab) {
      up = tab == 'up'
      tier = up ? tier : Number(tab)
      picked = null
    }
    if (pick) picked = pick
    if (act == 'make' && picked) acts.make(picked)
    if (act == 'upgrade' && picked) acts.upgrade(picked)
    was = []
  })

  let tiers = (c: Craft) =>
    [
      ...new Set(
        Object.values(recipes()).filter((r) => r.at == c).map((r) => r.tier),
      ),
    ].sort((a, b) => a - b)

  // A need of a recipe: what it is, how much the bag holds of it, and the
  // kinds that serve.
  let need = (bag: Sheet['bag'], r: Recipe, [what, n]: [string, number]) => {
    let got = have(bag, what, r.tier)
    let kinds = serves(what, r.tier)
    let pic = icon(kinds.find((k) => bag.some((h) => h.kind == k)) ?? kinds[0])
    let name = (k: string) => ITEMS[k]?.name ?? k
    let names = kinds.length < 2
      ? ''
      : STUFF[what]?.tiered
      ? `${name(kinds[0])} or better`
      : `${kinds.slice(0, -1).map(name).join(', ')} or ${
        name(kinds[kinds.length - 1])
      }`
    names = names && `<small>${esc(names)}</small>`
    return `<span class="Craft_Need${got < n ? ' Craft_Need-short' : ''}"><i>${
      pic || '•'
    }</i><b>${esc(stuffName(what))}</b><em>${got} / ${n}</em>${names}</span>`
  }

  // The pieces the hero wears and carries that a station upgrades: what is
  // worn first, then the finest.
  let pieces = (s: Sheet, c: Craft): Held[] => {
    let worn = SLOTS.flatMap((slot) => s.worn[slot] ?? [])
    let rest = s.bag.filter((h) =>
      ITEMS[h.kind]?.slot && !worn.some((w) => w.eid == h.eid)
    ).sort((a, b) =>
      RARITIES.indexOf(b.rarity ?? 'common') -
        RARITIES.indexOf(a.rarity ?? 'common') ||
      (ITEMS[b.kind].tier ?? 0) - (ITEMS[a.kind].tier ?? 0)
    )
    return [...worn, ...rest].filter((h) => madeBy(h.kind)?.at == c)
  }

  // What the hero would wear with `h` as `x`: where it is worn, or where it
  // would go.
  let wearing = (s: Sheet, h: Held, x: Held) => {
    let slot = SLOTS.find((sl) => s.worn[sl]?.eid == h.eid)
    return trying(slot ? s.worn : trying(s.worn, h), x, slot)
  }

  // What the next step makes of a piece, worn, as a card; nothing past its
  // last step.
  let ahead = (s: Sheet, h: Held) => {
    let [lo, hi] = upgradeRange(h)
    return upgradeOf(h.kind, h.plus ?? 0)
      ? stepRange(
        s,
        { label: 'Now', p: piece(h), worn: wearing(s, h, h) },
        { label: 'Least', p: piece(lo), worn: wearing(s, h, { ...h, ...lo }) },
        { label: 'Most', p: piece(hi), worn: wearing(s, h, { ...h, ...hi }) },
      )
      : undefined
  }

  // A recipe's possible numbers, one range per stat; the high end of each
  // may come from a different legendary roll.
  let makingRange = (kind: string) => {
    let t = ITEMS[kind]
    if (!t?.slot || !t.tier) return ''
    let [lo, hi] = tierRange(t.tier), values = statRange(kind)
    let lines = GEAR_STATS.flatMap((stat) => {
      let pair = values[stat]
      if (!pair) return []
      let [a, b] = pair.map((n) => statValue(stat, n))
      return [
        `<span class=Pack_Num>${a == b ? a : `${a}–${b}`} ${
          statName(stat)
        }</span>`,
      ]
    }).join('')
    return `<div class=Craft_Ranges><small>Possible per-stat ranges · Level ${lo}–${hi} · Common–Legendary</small>${lines}</div>`
  }

  // A piece's tip on the upgrade tab: what its next step makes of it; its
  // words past its last step.
  cards(box, (e) => {
    let h = up
      ? sheet?.bag.find((h) => h.eid == e.getAttribute('data-pick'))
      : null
    return sheet && h ? ahead(sheet, h) : undefined
  })

  // A piece picked to upgrade: what it is, what the next step asks, and what
  // it would change, worn.
  let upgrading = (s: Sheet, trades: Trades, job: Job) => {
    let h = s.bag.find((h) => h.eid == picked)
    if (!h) {
      return `<p class=Pack_Hint>Tap something you carry to upgrade it.</p>`
    }
    let t = piece(h), plus = h.plus ?? 0
    let r = upgradeOf(h.kind, plus)
    let bag = spare(s.bag, Object.values(s.worn))
    let what = `${sortLine(t)} · +${plus} of ${MOST}`
    let working = job.doing?.piece == h.eid ? job.doing : null
    let trade = r && TRADES[r.at]
    let button = !r || !trade
      ? `<span class=Pack_Hint>As fine as it gets.</span>`
      : !able(r, trades[r.at].lvl)
      ? `<span class=Pack_Hint>Requires ${trade.name} ${least(r.tier)}</span>`
      : working
      ? `<button class="Btn Btn-go Craft_Go" style="--k:${
        working.k.toFixed(3)
      }">Upgrading…</button>`
      : `<button class="Btn Btn-go" data-do=upgrade${
        plan(r, bag) ? '' : ' disabled'
      }>Upgrade to +${plus + 1}</button>`
    return `<div class=Pack_Card><i class="Pack_Big ${tint(t.rarity)}">${
      icon(h.kind) || '•'
    }</i><div><b class="Rarity ${tint(t.rarity)}">${esc(t.name)}</b><span>${
      esc(what)
    }</span></div>${button}</div>` +
      (r
        ? `<div class=Craft_Needs>${
          r.needs.map((n) => need(bag, r, n)).join('')
        }</div>`
        : '') +
      (ahead(s, h) ?? '')
  }

  let card = (s: Sheet, trades: Trades, job: Job) => {
    let r = picked ? recipes()[picked] : null
    if (!r) return `<p class=Pack_Hint>Tap something to see what it needs.</p>`
    let t = ITEMS[r.makes]
    let bag = spare(s.bag, Object.values(s.worn))
    let trade = TRADES[r.at]
    let making = job.doing?.recipe == r.makes && !job.doing.piece
      ? job.doing
      : null
    let what = !t
      ? ''
      : t.heals
      ? `Drink it to mend ${t.heals} (Q)`
      : `${sortOf(t)} · tier ${tierName(r.tier)}`
    let button = !able(r, trades[r.at].lvl)
      ? `<span class=Pack_Hint>Requires ${trade.name} ${least(r.tier)}</span>`
      : making
      ? `<button class="Btn Btn-go Craft_Go" style="--k:${
        making.k.toFixed(3)
      }">${STATIONS[r.at].doing}…</button>`
      : `<button class="Btn Btn-go" data-do=make${
        plan(r, bag) ? '' : ' disabled'
      }>${STATIONS[r.at].verb}</button>`
    return `<div class=Pack_Card><i class=Pack_Big>${
      icon(r.makes) || '•'
    }</i><div><b>${esc(t?.name ?? r.makes)}</b><span>${
      esc(what)
    }</span></div>${button}</div>` +
      `<div class=Craft_Needs>${
        r.needs.map((n) => need(bag, r, n)).join('')
      }</div>` + makingRange(r.makes)
  }

  let draw = (c: Craft, s: Sheet, trades: Trades, job: Job) => {
    let trade = TRADES[c], mine = trades[c]
    let next = tradeNeed(mine.lvl + 1)
    let bag = spare(s.bag, Object.values(s.worn))
    let upgrades = pieces(s, c)
    let tabs =
      tiers(c).map((n) =>
        `<button class="Pack_Tile${
          !up && n == tier ? ' Craft_Tier-on' : ''
        }" data-tier=${n}><span>${
          mine.lvl >= least(n) ? '' : glyphText('lock')
        }${tierName(n)}</span></button>`
      ).join('') +
      (Object.values(recipes()).some((r) => r.at == c && ITEMS[r.makes]?.slot)
        ? `<button class="Pack_Tile Craft_Up${
          up ? ' Craft_Tier-on' : ''
        }" data-tier=up${tipped({ name: 'Upgrade what you carry' })}>${
          glyphText('sparkles')
        }<span>Upgrade</span></button>`
        : '')
    let tiles = up
      ? upgrades.map((h) => {
        // Dimmed past its last step, or while its next asks more of the
        // trade than the hero has.
        let t = piece(h), r = upgradeOf(h.kind, h.plus ?? 0)
        return `<button class="Pack_Tile ${tint(t.rarity)}${
          picked == h.eid ? ' Pack_Tile-on' : ''
        }${
          r && able(r, mine.lvl) ? '' : ' Pack_Tile-had'
        }" data-pick="${h.eid}"${tipped({ name: t.name })}><i>${
          icon(h.kind) || '•'
        }</i>${h.plus ? `<b>+${h.plus}</b>` : ''}</button>`
      }).join('') ||
        `<span class=Pack_Hint>Nothing you carry is upgraded here.</span>`
      : Object.values(recipes())
        .filter((r) => r.at == c && r.tier == tier)
        .map((r) => {
          let t = ITEMS[r.makes]
          let ready = able(r, mine.lvl) && plan(r, bag)
          return `<button class="Pack_Tile${
            picked == r.makes ? ' Pack_Tile-on' : ''
          }${ready ? '' : ' Pack_Tile-had'}" data-pick="${r.makes}"${
            tipped({ name: t?.name ?? r.makes })
          }><i>${icon(r.makes) || '•'}</i></button>`
        }).join('')
    panel.head(
      `${STATIONS[c].name} <span class=Badge>${
        glyphText(trade.icon)
      } ${trade.name} ${mine.lvl}</span><small class=Panel_Note>${mine.xp} / ${next} xp</small>`,
    )
    panes.render(
      `<div class="Pack Craft">` +
        `<div class=Craft_Tiers>${tabs}</div>` +
        `<div class=Pack_Grid>${tiles}</div></div>`,
      up ? upgrading(s, trades, job) : card(s, trades, job),
      picked,
    )
  }

  return {
    /** which station the sheet is open at, if it is */
    get at() {
      return panel.open ? at : null
    },
    /** open the sheet at a station, at the best tier the hero may make */
    open: (c: Craft, trades: Trades) => {
      at = c
      up = false
      picked = null
      tier = Math.max(1, ...tiers(c).filter((n) => trades[c].lvl >= least(n)))
      panel.show()
      was = []
    },
    close: panel.close,
    /** show this frame, when the sheet is open and what it shows changed */
    show: (s: Sheet, job: Job) => {
      sheet = s
      if (!panel.open || !at) return
      let k = job.doing?.recipe ? job.doing.k.toFixed(2) : ''
      let key = [s, job.trades, k, at, tier, up, picked, ITEMS]
      if (key.every((v, i) => v === was[i])) return
      was = key
      draw(at, s, job.trades, job)
    },
  }
}
