import type { Bundle } from '@yaks/graph'
import { renderToString } from 'preact-render-to-string'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import {
  type PaymentRows,
  type PaymentView,
  paymentView,
} from './payment-view.ts'
import {
  allowancesLine,
  allowancesRow,
  billedLine,
  billedRows,
  type PlanCard,
  planLine,
  planRow,
  sellingLine,
  sellingRow,
} from './payment-rows.ts'
import { appRows, sideApps } from './side-rows.ts'

export let SPACE = 'space-ada'
export let ADA = 'person-ada'

/** Every paid plan sold by the month and the year. */
export let SOLD: PlanCard['sold'] = {
  plus: ['month', 'year'],
  pro: ['month', 'year'],
}

/** Ada's space's Billing page, as the server says it beside the rows. */
export let paymentShown = (
  over: Partial<PaymentView> = {},
): PaymentView => ({
  person: ADA,
  view: 'billing',
  space: { eid: SPACE, slug: 'ada', title: 'ada' },
  apex: 'yaks.app',
  ...over,
})

/** The rows a page is drawn from: a free space nothing bills. */
export let paymentRows = (over: Partial<PaymentRows> = {}): PaymentRows => ({
  plan: { tier: 'free', ends: '', known: false, sold: SOLD },
  apps: [],
  ...over,
})

/** The payment view `view` drawn from `rows` as a server draws it. */
export let page = (
  view = paymentShown(),
  rows = paymentRows(),
): HTMLElement => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'payment', 'data-payment-view': JSON.stringify(view) },
      paymentView(view, rows),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}

/** The text a page drawn as `view` says of `rows`. */
export let said = (
  view: Partial<PaymentView> = {},
  rows: Partial<PaymentRows> = {},
): string => page(paymentShown(view), paymentRows(rows)).textContent!

/** Each line's rows in a page graph, from `rows`. */
export let lines = (rows = paymentRows()): [string, Bundle[]][] => [
  [planLine(SPACE), [planRow(SPACE, rows.plan)]],
  [sellingLine(SPACE), rows.selling ? [sellingRow(SPACE, rows.selling)] : []],
  [billedLine(SPACE), billedRows(SPACE, rows.payer ?? null)],
  [
    allowancesLine(SPACE),
    rows.allowances ? [allowancesRow(SPACE, rows.allowances)] : [],
  ],
  [sideApps(SPACE), appRows(ADA, SPACE, rows.apps)],
]
