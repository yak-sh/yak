// Read-only trade guides: gathering nodes and station recipes come from the
// same catalogs as work.ts. Crafting still requires visiting a village station.
import { type ComponentChildren, h } from 'preact'
import { Body, Rows, Tile } from '@yaks/ui'
import { gatherXp, LODES } from './gather.ts'
import { glyph } from './glyphs.ts'
import { ITEMS } from './items.ts'
import { icon } from './sprites.ts'
import { part, picture } from './tile.ts'
import { type Gather, least, TRADES } from './trades.ts'

/** Gathering trades teach where to work, each node a tile: what it gives,
 * the level it is best from, and the xp it brings at `lvl`; making trades
 * use station.ts. */
export let preview = (trade: Gather, lvl: number): ComponentChildren => [
  h(
    Tile,
    { mod: 'head' },
    picture(glyph(TRADES[trade].icon)),
    h(Tile.Title, {}, TRADES[trade].name),
    h(Tile.Sub, {}, `Gathering · level ${lvl}`),
  ),
  h(
    Body,
    {},
    h(
      'p',
      {},
      'Work these nodes in the world to gather materials and earn trade xp. ' +
        'Higher-tier nodes are most rewarding at their recommended trade level.',
    ),
  ),
  part(
    'Where to work',
    h(
      Rows,
      {},
      Object.values(LODES)
        .filter((node) => node.trade == trade)
        .sort((a, b) => a.tier - b.tier)
        .map((node) =>
          h(
            Tile,
            { key: node.name },
            picture(icon(node.gives) || '•'),
            h(Tile.Title, {}, node.name),
            h(Tile.Sub, {}, ITEMS[node.gives]?.name ?? node.gives),
            h(
              Tile.Sub,
              {},
              `Tier ${node.tier} · Best from level ${least(node.tier)} · ${
                gatherXp(node.tier, 'common', lvl)
              } xp at your level (common)`,
            ),
          )
        ),
    ),
  ),
]
