// Read-only trade guides: gathering nodes and station recipes come from the
// same catalogs as work.ts. Crafting still requires visiting a village station.
import {
  able,
  isStation,
  madeXp,
  recipes,
  serves,
  STATIONS,
  stuffName,
} from './craft.ts'
import { gatherXp, LODES } from './gather.ts'
import { ITEMS } from './items.ts'
import { type Gather, least, type Trade, TRADES } from './trades.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let gathering = (trade: Gather, lvl: number) =>
  `<p>Work these nodes in the world to gather materials and earn trade xp.
    Higher-tier nodes are most rewarding at their recommended trade level.</p>
    <ul class=Trades_Guide>${
    Object.values(LODES)
      .filter((node) => node.trade == trade)
      .sort((a, b) => a.tier - b.tier)
      .map((node) =>
        `<li><b>${esc(node.name)}</b><span>${
          esc(ITEMS[node.gives]?.name ?? node.gives)
        }</span><small>Tier ${node.tier} · Best from level ${
          least(node.tier)
        } · ${
          gatherXp(node.tier, 'common', lvl)
        } xp at your level (common)</small></li>`
      ).join('')
  }</ul>`

let making = (trade: Exclude<Trade, Gather>, lvl: number) => {
  let rows = Object.values(recipes()).filter((r) => r.at == trade)
    .sort((a, b) => a.tier - b.tier)
  return `<h4>${STATIONS[trade].name} preview</h4>
    <p>Visit a village's ${STATIONS[trade].name.toLowerCase()} to make these
    recipes from spare materials. This preview does not start crafting.</p>
    <ul class=Trades_Guide>${
    rows.map((r) => {
      let needs = r.needs.map(([what, n]) => {
        let kinds = serves(what, r.tier)
        let names = kinds.map((kind) => ITEMS[kind]?.name ?? kind).join(', ')
        return `${n} ${esc(stuffName(what))} <small>(${esc(names)})</small>`
      }).join(' · ')
      return `<li><b>${esc(ITEMS[r.makes]?.name ?? r.makes)}</b>
      <small>Tier ${r.tier} · ${
        able(r, lvl) ? 'Trade level ready' : `Requires level ${least(r.tier)}`
      } · ${madeXp(r.tier)} xp</small><span>${needs}</span></li>`
    }).join('') || '<li>No recipes available yet.</li>'
  }</ul>`
}

/** The selected trade's guide or bench preview, without game actions. */
export let preview = (trade: Trade, lvl: number) =>
  `<div class="Trades Trades_Preview"><h3 class=Pack_Head>${
    TRADES[trade].name
  }</h3>${isStation(trade) ? making(trade, lvl) : gathering(trade, lvl)}</div>`
