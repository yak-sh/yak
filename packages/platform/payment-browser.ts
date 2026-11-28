/**
 * A space's Selling and Billing pages in the browser (D-475 step 5). Each is
 * drawn from the space's rows (./payment-view.ts), and here it is drawn again
 * from the tab's page graph as they move: a plan bought or a seller's account
 * readied by the provider, a cap set in another tab, an app made, the month's
 * use read again. Its buttons write through the graph (./payment-rows.ts):
 * the cap joins the page's Save bar as `creditCap`, the invoice form writes
 * `invoiceAsk`, Disconnect writes `sellStop`, and a button that leaves for
 * the provider's page writes `leave`, whose answer says where to go.
 *
 * The view is `[data-view="payment"]`, saying what it draws for in
 * `data-payment-view` (`PaymentView`).
 *
 * @module
 */
import { fragment } from '@yaks/html/dom'
import type { Bundle } from '@yaks/graph'
import type { Client, Watch } from '@yaks/client'
import { mint } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { refusal, tell } from './account-browser.ts'
import { pageGraph } from './page-graph.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import {
  allowancesLine,
  billedLine,
  leaveTo,
  paymentWords,
  planLine,
  sellingLine,
} from './payment-rows.ts'
import { paymentOf, type PaymentView, paymentView } from './payment-view.ts'
import { sideApps, sideWords } from './side-rows.ts'

/** The Selling and Billing views. */
export let VIEW = '[data-view="payment"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** The rows `root` is drawn from, once each is in. */
export type Held = {
  plan: Bundle[]
  selling: Bundle[]
  billed: Bundle[]
  allowances: Bundle[]
  apps: Bundle[]
}

/** Draw `root` again from the rows its graph holds; nothing until the plan
 * is in. */
export let drawPayment = (
  root: HTMLElement,
  view: PaymentView,
  held: Held,
): void => {
  let rows = paymentOf(view.space.eid, Object.values(held).flat())
  if (!rows) return
  let next = root.cloneNode(false) as HTMLElement
  next.append(fragment(root.ownerDocument, paymentView(view, rows)))
  morph(root, next, KEPT)
}

// What a card says while its button waits, and of a refusal.
let say = (
  at: Element,
  view: PaymentView,
  words: string,
  refused = false,
) => {
  let notice = at.closest('.Bill')?.querySelector<HTMLElement>('.Bill_Say')
  if (!notice) return
  notice.className = 'Notice Bill_Say' +
    (refused ? ' Notice-negative' : words ? ' Loading' : '')
  if (!refused && words && view.loading) {
    notice.innerHTML = view.loading
    notice.append(Object.assign(at.ownerDocument.createElement('span'), {
      textContent: words,
    }))
  } else notice.textContent = words
}

/** Keep the payment view `root` drawn from `graph`, and write through it;
 * `go` follows the provider's page a button left for. The answer lets go of
 * it all. */
export let bindPayment = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  go: (url: string) => void = (url) => location.assign(url),
): () => void => {
  let view = JSON.parse(root.dataset.paymentView!) as PaymentView
  let space = view.space.eid
  let watches: Partial<Record<keyof Held, Watch>> & { plan: Watch } = {
    plan: graph.watch(planLine(space)),
    ...view.view == 'selling'
      ? {
        selling: graph.watch(sellingLine(space)),
        apps: graph.watch(sideApps(space)),
      }
      : {
        billed: graph.watch(billedLine(space)),
        allowances: graph.watch(allowancesLine(space)),
      },
  }
  let all = Object.values(watches) as Watch[]
  let held = (): Held => ({
    plan: watches.plan.value,
    selling: watches.selling?.value ?? [],
    billed: watches.billed?.value ?? [],
    allowances: watches.allowances?.value ?? [],
    apps: watches.apps?.value ?? [],
  })
  let lost = "That didn't go through. Try again?"
  let capped = async (body: FormData) => {
    try {
      await graph.mutate([{
        entity: { eid: mint() },
        creditCap: { space, cap: Number(body.get('cap')) },
      }])
    } catch (error) {
      throw new CallError(
        'arguments',
        refusal(error, 'Your cap could not be saved. It is kept here.'),
      )
    }
    return undefined
  }
  let draw = () => {
    drawPayment(root, view, held())
    let cap = root.querySelector<SavingForm>('form[data-save="credit-cap"]')
    if (cap) cap[SAVE_THROUGH] = capped
  }
  let off = all.map((w) => w.subscribe(draw))
  let leave = async (button: HTMLButtonElement) => {
    button.disabled = true
    say(button, view, 'One moment…')
    try {
      let to = await leaveTo(graph, space, button)
      if (to) return go(to)
      say(button, view, lost, true)
    } catch (error) {
      say(button, view, refusal(error, lost), true)
    }
    button.disabled = false
  }
  let stop = async (button: HTMLButtonElement) => {
    button.disabled = true
    say(button, view, '')
    try {
      await graph.mutate([{ entity: { eid: mint() }, sellStop: { space } }])
    } catch (error) {
      say(button, view, refusal(error, lost), true)
    }
    button.disabled = false
  }
  let click = async (e: Event) => {
    let target = e.target as Element
    let door = target.closest<HTMLButtonElement>('.Bill_Go')
    if (door) return await leave(door)
    let off = target.closest<HTMLButtonElement>('[data-sell-stop]')
    if (off) return await stop(off)
  }
  let submit = async (e: Event) => {
    let form = e.target as HTMLFormElement
    if (!form.matches('[data-invoice]')) return
    e.preventDefault()
    let field = (name: string) =>
      form.querySelector<HTMLInputElement>(`[name=${name}]`)?.value.trim() ??
        ''
    let send = form.querySelector<HTMLButtonElement>('[type=submit]')
    if (send) send.disabled = true
    tell(form, '')
    try {
      await graph.mutate([{
        entity: { eid: mint() },
        invoiceAsk: {
          space,
          email: field('email'),
          name: field('name'),
        },
      }])
      tell(
        form,
        'The invoice reaches the address you gave within the hour. ' +
          'The Pro plan starts when it is paid.',
      )
    } catch (error) {
      tell(form, refusal(error, lost), true)
    }
    if (send) send.disabled = false
  }
  root.addEventListener('click', click)
  root.addEventListener('submit', submit)
  draw()
  return () => {
    root.removeEventListener('click', click)
    root.removeEventListener('submit', submit)
    for (let stop of off) stop()
    for (let w of all) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.paymentView!) as PaymentView
      let stop = bindPayment(root, pageGraph([paymentWords, sideWords], person))
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
