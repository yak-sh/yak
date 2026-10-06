// The Trades panel: trade progress beside gathering guides and station menus.
import { glyph } from './glyphs.ts'
import type { Page } from './panel.ts'
import { type ComponentChildren, h, render } from 'preact'
import { Button, Rows, Tile } from '@yaks/ui'
import { isStation } from './craft.ts'
import { type PageState, pageState } from './page-state.ts'
import type { Sheet } from './play.ts'
import type { Job } from './work.ts'
import { menu } from './station.ts'
import { focused, selected, selection } from './ux-kit.ts'
import { hint, part, picture } from './tile.ts'
import { ValeMeter } from './kit/ValeMeter.ts'
import { ITEMS } from './items.ts'

import {
  ALL,
  type Gather,
  GATHERING,
  MAKING,
  type Trade,
  tradeNeed,
  TRADES,
} from './trades.ts'
/** Trade progress beside its gathering guide or the station's own menu. */
export let ledger = (
  tab: Page,
  guide: (trade: Gather, lvl: number) => ComponentChildren,
  state: PageState = pageState(),
  owner = 'trades',
) => {
  let sheet: Sheet | null = null, job: Job | null = null
  tab.body.classList.add('Split_Host')
  tab.body.closest('.Panel_Sheet')?.classList.add('Split_Sheet')
  // A trade's xp toward its next level, as the sub under its name.
  let bar = ({ xp, lvl }: { xp: number; lvl: number }) => {
    let from = tradeNeed(lvl), to = tradeNeed(lvl + 1)
    return h(
      Tile.Sub,
      {},
      h(ValeMeter, {
        label: 'XP',
        value: xp - from,
        max: to - from,
        tone: 'experience',
      }),
    )
  }
  let draw = () => {
    if (!tab.open || !sheet || !job) return
    let cursor = state.cursor(owner), picked = ALL.find((t) => t == cursor)
    let e = state.list(owner)
    let detail = picked && isStation(picked)
      ? menu(picked, sheet, job, { state, owner: `${owner}/${picked}` }, draw)
      : picked
      ? guide(picked as Gather, job.trades[picked].lvl)
      : hint(
        'Select a trade for its gathering guide or crafting bench preview.',
      )
    let list = (
      title: string,
      trades: Trade[],
    ) =>
      part(
        title,
        h(
          Rows,
          {},
          trades.map((trade) => {
            let progress = job!.trades[trade]
            return h(
              Tile,
              {
                key: trade,
                mod: picked == trade && 'on',
                'data-select': trade,
                onClick: () => {
                  state.mutate([focused(selected(e, trade), 'detail')])
                  draw()
                },
              },
              picture(glyph(TRADES[trade].icon)),
              h(Tile.Title, {}, TRADES[trade].name),
              bar(progress),
              h(Tile.End, {}, `Level ${progress.lvl}`),
            )
          }),
        ),
      )
    render(
      h(
        'div',
        {
          class: `Split${
            picked && selection(e).pane == 'detail' ? ' Split-picked' : ''
          }`,
        },
        h(
          'section',
          { class: 'Split_List', 'aria-label': 'Trades' },
          h(
            'div',
            { class: 'Pack' },
            list('Gathering', GATHERING),
            list('Making', MAKING),
          ),
        ),
        h(
          'section',
          { class: 'Split_Detail', 'aria-label': 'Selected trade' },
          h(Button, {
            class: 'Split_Back',
            type: 'button',
            onClick: () => {
              state.mutate([focused(e, 'list')])
              draw()
            },
          }, 'Back to list'),
          h('div', { class: 'Split_Content' }, detail),
        ),
      ),
      tab.body,
    )
  }
  let was: unknown[] = []
  return {
    /** Show this frame's sheet and trades. It runs every frame, so drawing
     * the tab again when nothing it shows has changed is a bug: it draws as
     * it opens and as the sheet or the trades change, and a pick draws it
     * itself. */
    show: (s: Sheet, latest: Job) => {
      sheet = s
      job = latest
      if (!tab.open) return void (was = [])
      let key = [s, latest.trades, ITEMS]
      if (key.every((v, i) => v === was[i])) return
      was = key
      draw()
    },
  }
}
