// Read-only trade guides: gathering nodes and station recipes come from the
// same catalogs as work.ts. Crafting still requires visiting a village station.
import { gatherXp, LODES } from './gather.ts'
import { ITEMS } from './items.ts'
import { type Gather, least, TRADES } from './trades.ts'

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

/** Gathering trades teach where to work; making trades use station.ts. */
export let preview = (trade: Gather, lvl: number) =>
  `<div class="Trades Trades_Preview"><h3 class=Pack_Head>${
    TRADES[trade].name
  }</h3>${gathering(trade, lvl)}</div>`
