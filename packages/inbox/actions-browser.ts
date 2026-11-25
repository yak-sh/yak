import type { Client } from '@yaks/client'
import {
  type ActionKind,
  actionLabel,
  answerField,
  type InboxAction,
  type InboxReceipt,
} from './actions.ts'
import front from './front.json' with { type: 'json' }
import type { VocabDoc } from '@yaks/vocab'

/** The words a page graph speaks to take an inbox's card actions. */
export let actionWords: VocabDoc[] = [front as VocabDoc]

let FORM = 'form[data-inbox-action]'
let CARD = '[data-inbox-card]'

/** Said, bubbling, by a view that drew its cards again in place: each card
 * keeps its `data-inbox-card`, and the actions paint what they hold on it
 * again. */
export let REDRAWN = 'inbox:redrawn'

let paint = (card: HTMLElement, page: Client, eid: string) => {
  let row = page.ent(eid)
  let action = row?.inboxAction as InboxAction | undefined
  let receipt = row?.inboxReceipt as InboxReceipt | undefined
  let note = row?.inboxActionNote as { message?: string } | undefined
  let taken = !!action?.kind
  let label = receipt?.label ?? note?.message ??
    (taken ? actionLabel(action!) : '')
  let status = card.querySelector<HTMLOutputElement>('[data-inbox-status]')!
  let focused = card.ownerDocument.activeElement?.closest(FORM)
  for (let form of card.querySelectorAll<HTMLElement>(FORM)) form.hidden = taken
  for (let part of card.querySelectorAll<HTMLElement>('[data-inbox-pending]')) {
    part.hidden = taken
  }
  status.textContent = label
  status.hidden = !label
  card.hidden = action?.kind == 'dismiss' && !note?.message
  if (taken && focused && !card.hidden) status.focus()
  return receipt
}

let less = (badge: HTMLElement) => {
  let n = Math.max(0, Number(badge.textContent) - 1)
  badge.textContent = n ? String(n) : ''
  badge.hidden = !n
  if (badge.dataset.waiting) {
    badge.dataset.waiting = String(
      Math.max(0, Number(badge.dataset.waiting) - 1),
    )
  }
}

let answered = (root: HTMLElement, slug: string) => {
  let doc = root.ownerDocument
  if (root.dataset.inboxHome != slug) return
  for (let badge of doc.querySelectorAll<HTMLElement>('[data-waiting]')) {
    less(badge)
  }
  let app = doc.querySelector<HTMLElement>('[data-alerts-offer][data-badge]')
  if (!app) return
  let count = Math.max(0, Number(app.dataset.badge) - 1)
  app.dataset.badge = String(count)
  void doc.defaultView?.navigator.setAppBadge?.(count)?.catch(() => {})
}

/** Bind the live state of an inbox to its existing forms and card markup. */
export let bindActions = (
  root: HTMLElement,
  page: Client,
  lifetime: AbortSignal,
): void => {
  let held = new Set<string>()
  root.addEventListener(REDRAWN, () => {
    for (let eid of held) {
      let card = root.querySelector<HTMLElement>(`[data-inbox-card="${eid}"]`)
      if (card) paint(card, page, eid)
    }
  }, { signal: lifetime })
  root.addEventListener('submit', (event) => {
    let form = event.target as HTMLFormElement | null
    if (!form?.matches(FORM)) return
    let card = form.closest<HTMLElement>(CARD)!
    let eid = card.dataset.inboxCard!
    let entity = { eid }
    event.preventDefault()
    if ((page.ent(eid)?.inboxAction as InboxAction | undefined)?.kind) return
    if (!held.has(eid)) {
      let watch = page.watch(`.entity.eid=${eid}`, { remote: false })
      let waiting = card.dataset.inboxWaits
      watch.subscribe(() => {
        if (paint(card, page, eid) && waiting) {
          answered(root, waiting)
          waiting = undefined
        }
      })
      lifetime.addEventListener('abort', () => watch.close(), { once: true })
      held.add(eid)
    }
    let kind = form.dataset.inboxAction as ActionKind
    let data = new FormData(form, (event as SubmitEvent).submitter)
    let inboxAction: InboxAction = {
      kind,
      space: form.dataset.inboxSpace!,
      target: String(data.get(kind) ?? ''),
      answer: String(data.get(answerField(kind)) ?? ''),
    }
    let send = async () => {
      try {
        await page.mutate([{ entity, inboxAction, inboxActionNote: null }])
      } catch (error) {
        let message = (error as { outcome?: string })?.outcome == 'refused'
          ? (error as Error).message
          : 'Waiting to confirm. We’ll try again.'
        await page.mutate([{ entity, inboxActionNote: { message } }])
      }
    }
    void send().catch((error) => globalThis.reportError?.(error))
  }, { signal: lifetime })
}
