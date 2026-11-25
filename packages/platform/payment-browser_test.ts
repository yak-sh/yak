import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { bindPayment } from './payment-browser.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import { planLine, planRow, sellingLine, sellingRow } from './payment-rows.ts'
import type { PaymentRows, PaymentView } from './payment-view.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  lines,
  page,
  paymentRows,
  paymentShown,
  SOLD,
  SPACE,
} from './payment_fixture_test.ts'

// A payment page bound to a page graph holding `rows`, each write answered
// by `answer`, and every page it left for kept in `went`.
let bound = (
  { view = paymentShown(), rows = paymentRows(), answer = ok }: {
    view?: PaymentView
    rows?: PaymentRows
    answer?: (b: Bundle[]) => Promise<Bundle[]>
  } = {},
) => {
  let root = page(view, rows)
  let g = graph(answer)
  for (let [line, held] of lines(rows)) g.set(line, held)
  let went: string[] = []
  bindPayment(root, g, (url) => went.push(url))
  let click = async (selector: string) => {
    root.querySelector<HTMLElement>(selector)!.click()
    for (let n = 0; n < 5; n++) await Promise.resolve()
  }
  return { root, g, went, click }
}
let ok = (b: Bundle[]) => Promise.resolve(b)
let refused = (b: Bundle[]) =>
  Promise.reject(
    new WriteRefused(b, {
      error: 'conflict',
      message: 'Ada is already on the Plus plan.',
    } as never),
  )
let acts = (g: ReturnType<typeof bound>['g']) =>
  g.wrote.map((b) => b.map(({ entity: _, ...act }) => act))
let notice = (root: HTMLElement) => root.querySelector('.Bill_Say')!.textContent

test('the plan bought elsewhere redraws the page without a reload', () => {
  let { root, g } = bound()
  equal(!!root.querySelector('[data-door="checkout"]'), true)
  g.set(planLine(SPACE), [
    planRow(SPACE, { tier: 'plus', ends: '', known: true, sold: SOLD }),
  ])
  equal(!!root.querySelector('[data-door="checkout"]'), false)
  equal(!!root.querySelector('[data-door="portal"]'), true)
})

test('a plan button leaves for the page the door answers', async () => {
  let answer = (b: Bundle[]) =>
    Promise.resolve(b.map((x) => ({
      ...x,
      leave: { ...x.leave as object, url: 'https://pay.test/c' },
    })))
  let { g, went, click } = bound({ answer })
  await click('[data-plan="pro"][data-per="year"]')
  equal(acts(g), [[{
    leave: { space: SPACE, door: 'checkout', tier: 'pro', per: 'year' },
  }]])
  equal(went, ['https://pay.test/c'])
})

test('a refusal is said on the card the button is in', async () => {
  let { root, went, click } = bound({ answer: refused })
  await click('[data-door="checkout"]')
  equal(went, [])
  equal(notice(root), 'Ada is already on the Plus plan.')
})

test('the cap joins the Save bar, and the invoice is asked for in its form', async () => {
  let rows = paymentRows({
    plan: {
      tier: 'pro',
      ends: '',
      known: false,
      sold: { plus: [], pro: ['year'] },
      credit: { cap: 0, left: 0, drawn: 0, buy: false },
    },
  })
  let { root, g } = bound({ rows })
  let cap = root.querySelector<SavingForm>('form[data-save="credit-cap"]')!
  let body = new FormData()
  body.set('cap', '25')
  await cap[SAVE_THROUGH]!(body)
  equal(acts(g), [[{ creditCap: { space: SPACE, cap: 25 } }]])
  let free = bound({
    rows: paymentRows({
      plan: { tier: 'free', ends: '', known: false, sold: SOLD, invoice: 60 },
    }),
  })
  let form = free.root.querySelector<HTMLFormElement>('form[data-invoice]')!
  form.querySelector<HTMLInputElement>('[name=email]')!.value = ' a@b.test '
  form.querySelector<HTMLInputElement>('[name=name]')!.value = 'Oak Street'
  let { Event } = form.ownerDocument.defaultView as unknown as {
    Event: typeof globalThis.Event
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  for (let n = 0; n < 5; n++) await Promise.resolve()
  equal(acts(free.g), [[{
    invoiceAsk: { space: SPACE, email: 'a@b.test', name: 'Oak Street' },
  }]])
  equal(
    form.querySelector('[data-said]')!.textContent!.startsWith(
      'The invoice reaches the address you gave',
    ),
    true,
  )
})

test('Disconnect stops selling, and the page redraws as the door answers', async () => {
  let ready = {
    state: 'ready' as const,
    house: false,
    linkable: false,
    provider: 'Paybox',
    fee: 0,
  }
  let rows = paymentRows({
    plan: { tier: 'plus', ends: '', known: true, sold: SOLD },
    selling: ready,
  })
  let { root, g, click } = bound({
    view: paymentShown({ view: 'selling' }),
    rows,
  })
  await click('[data-sell-stop]')
  equal(acts(g), [[{ sellStop: { space: SPACE } }]])
  g.set(sellingLine(SPACE), [sellingRow(SPACE, { ...ready, state: 'none' })])
  equal(!!root.querySelector('[data-sell-stop]'), false)
  equal(
    root.querySelector('[data-door="start"]')?.textContent,
    'Create a Paybox account',
  )
})

test('until the plan is in, the page stays as the server drew it', () => {
  let root = page()
  let before = root.innerHTML
  bindPayment(root, graph(ok))
  equal(root.innerHTML, before)
})
