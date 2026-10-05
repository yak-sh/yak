// The Trades panel: trade progress beside gathering guides and station menus.
import { glyph } from './glyphs.ts'
import type { Page } from './panel.ts'
import { h, render } from 'preact'
import { Button } from '@yaks/ui'
import { isStation } from './craft.ts'
import { type PageState, pageState } from './page-state.ts'
import type { Sheet } from './play.ts'
import type { Job } from './work.ts'
import { menu } from './station.ts'
import { focused, selected, selection } from './ux-kit.ts'

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
  guide: (trade: Gather, lvl: number) => string,
  state: PageState = pageState(),
  owner = 'trades',
) => {
  let sheet: Sheet | null = null, job: Job | null = null
  tab.body.classList.add('Split_Host')
  tab.body.closest('.Panel_Sheet')?.classList.add('Split_Sheet')
  let bar = ({ xp, lvl }: { xp: number; lvl: number }) => {
    let from = tradeNeed(lvl), to = tradeNeed(lvl + 1)
    return h(
      'div',
      { class: 'Bar Bar-xp' },
      h('i', { style: { '--k': ((xp - from) / (to - from)).toFixed(3) } }),
      h('span', {}, `${xp - from} / ${to - from} xp`),
    )
  }
  let draw = () => {
    if (!tab.open || !sheet || !job) return
    let cursor = state.cursor(owner), picked = ALL.find((t) => t == cursor)
    let e = state.list(owner)
    let detail = picked && isStation(picked)
      ? menu(picked, sheet, job, { state, owner: `${owner}/${picked}` }, draw)
      : picked
      ? h('div', {
        dangerouslySetInnerHTML: {
          __html: guide(picked as Gather, job.trades[picked].lvl),
        },
      })
      : h(
        'p',
        {},
        'Select a trade for its gathering guide or crafting bench preview.',
      )
    let list = (
      title: string,
      trades: Trade[],
    ) => [
      h('h3', { class: 'Pack_Head' }, title),
      h(
        'ul',
        { class: 'Trades_List' },
        trades.map((trade) => {
          let progress = job!.trades[trade]
          return h(
            'li',
            { key: trade },
            h(
              Button,
              {
                class: `Split_Row Trades_Row${
                  picked == trade ? ' Split_Row-on' : ''
                }`,
                type: 'button',
                'data-select': trade,
                'aria-pressed': picked == trade,
                onClick: () => {
                  state.mutate([focused(selected(e, trade), 'detail')])
                  draw()
                },
              },
              h('i', {
                dangerouslySetInnerHTML: { __html: glyph(TRADES[trade].icon) },
              }),
              h('b', {}, TRADES[trade].name),
              h('small', {}, `Level ${progress.lvl}`),
              bar(progress),
            ),
          )
        }),
      ),
    ]
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
            { class: 'Trades' },
            list('Gathering', GATHERING),
            list('Making', MAKING),
          ),
        ),
        h(
          'section',
          { class: 'Split_Detail', 'aria-label': 'Selected trade' },
          h(Button, {
            class: 'Btn Btn-small Split_Back',
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
  return {
    show: (s: Sheet, latest: Job) => {
      sheet = s
      job = latest
      draw()
    },
  }
}
