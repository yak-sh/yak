// Alerts on the device a person is holding (operator-alerts.ts): allowing a
// browser's notifications (@yaks/push/browser), the offer in the conversation
// that does it in one press once the Operator starts long work
// (operator-page.ts `alertsOffer`), the installed page's icon showing how
// many things need them, and the notifications this device still shows of
// things they read or answered since, taken away as the page is seen. Apple
// delivers web push only to a page added to an iPhone's Home Screen, after a
// press there, so in an iPhone's browser the offer says to add it first.
import { CallError } from '@yaks/tools/errors'
import { badge, subscribe, tidy, Unallowed } from '@yaks/push/browser'
import { leaving, PAGE } from '@yaks/ui/navigate'

export { badge }

let report = (error: unknown) =>
  queueMicrotask(() => {
    throw error
  })

let refusal = async (response: Response, otherwise: string) => {
  let message = (await response.json().catch(() => null))?.message ?? otherwise
  return response.status >= 500
    ? new Error(message)
    : new CallError('arguments', message)
}

/** Allows notifications on this browser: subscribes it with yaks.app's
 * public VAPID `key` (@yaks/push/browser `subscribe`, the worker at
 * /push.js) and keeps the subscription at `at` (operator-page.ts `?push`).
 * Call it from the press itself: a browser asks only then. While the push
 * service refuses, it tries again later, calling `waiting` once. */
export let allow = async (
  key: string,
  at: string,
  waiting?: () => void,
) => {
  let sub = await subscribe(key, { waiting }).catch((error) => {
    throw error instanceof Unallowed
      ? new CallError('arguments', error.message)
      : error
  })
  let response = await fetch(at, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  })
  if (!response.ok) {
    throw await refusal(
      response,
      'This browser could not be allowed. Try again.',
    )
  }
}

/** Takes away the notifications this device shows of things the person
 * read or answered since, asking the page's Operator at `at` which
 * (operator-page.ts `?handled`). */
export let tidied = (at: string) =>
  tidy(async (tags) => {
    let response = await fetch(`${at}?handled=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tags),
    })
    if (!response.ok) throw await refusal(response, 'Not read.')
    return (await response.json()).handled ?? []
  })

// An iPhone or iPad, whose browser takes no push until the page is added to
// its Home Screen and opened from there. iPadOS calls itself a Mac with touch.
let apple = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
let installed = () =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true

// Whether this device already brings this person's alerts.
let alerting = async (on: boolean) => {
  if (!on || Notification.permission != 'granted') return false
  let worker = await navigator.serviceWorker.getRegistration('/')
  return !!await worker?.pushManager.getSubscription()
}

/** The event the chat sends when the Operator starts work that will take a
 * while (operator-aside.ts `long`), which is when the offer asks; the chat
 * also marks the offer `data-due`, in case it said so before this ran. */
export let LONG_WORK = 'yak-long-work'

// The offer's moment: the work is long.
let due = (root: Document, box: HTMLElement, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    if (box.hasAttribute('data-due') || signal?.aborted) return done()
    let end = () => {
      root.removeEventListener(LONG_WORK, end)
      signal?.removeEventListener('abort', end)
      done()
    }
    root.addEventListener(LONG_WORK, end, { signal })
    signal?.addEventListener('abort', end, { once: true })
  })

/** The offer of alerts on this device, as `alertsOffer` drew it: each of its
 * parts hidden until this device is known and the Operator starts long work
 * (`LONG_WORK`). A device that already brings them, or a person who said Not
 * now, is offered nothing; an iPhone's browser says to add the page to the
 * Home Screen; one that can be allowed offers the press, which allows it and
 * chooses notifications as the way the person is alerted. Not now is kept on
 * the person (operator-page.ts `?alerts`), and the offer says where alerts
 * are turned on instead. */
export let offer = async (root: Document = document, signal?: AbortSignal) => {
  let box = root.querySelector<HTMLElement>('[data-alerts-offer]')
  if (!box) return
  if (box.dataset.badge) badge(Number(box.dataset.badge))
  if (box.dataset.on != null) seen(root, box.dataset.at!, signal)
  let part = (name: string) =>
    box.querySelector<HTMLElement>(`[data-shows=${name}]`)
  if (!part('offer')) return
  let asked = apple() && !installed()
    ? 'install'
    : !('serviceWorker' in navigator) || !('PushManager' in globalThis) ||
        Notification.permission == 'denied' ||
        await alerting(box.dataset.on != null)
    ? null
    : 'offer'
  if (!asked) return
  await due(root, box, signal)
  if (signal?.aborted) return
  let card = part(asked)!
  let said = card.querySelector<HTMLElement>('[data-status]')!
  let leave = (name: string) => {
    if (signal?.aborted) return
    card.hidden = true
    let left = part(name)!
    left.hidden = false
    left.addEventListener('animationend', () => box.remove(), {
      once: true,
      signal,
    })
  }
  let choose = async (body: Record<string, string>, otherwise: string) => {
    let response = await fetch(`${box.dataset.at}?alerts=1`, {
      method: 'POST',
      body: new URLSearchParams(body),
    })
    if (!response.ok) throw await refusal(response, otherwise)
  }
  let pressed =
    (act: () => Promise<void>, otherwise: string) => async (e: Event) => {
      let press = e.currentTarget as HTMLButtonElement
      press.disabled = true
      said.textContent = ''
      try {
        await act()
      } catch (error) {
        if (!(error instanceof CallError)) report(error)
        if (signal?.aborted) return
        said.textContent = error instanceof CallError
          ? error.message
          : otherwise
      }
      if (!signal?.aborted) press.disabled = false
    }
  card.hidden = false
  card.querySelector('[data-not-now]')!.addEventListener(
    'click',
    pressed(async () => {
      await choose({ declined: '1' }, 'That could not be saved. Try again.')
      leave('away')
    }, 'That could not be saved. Try again.'),
    { signal },
  )
  if (asked != 'offer') return
  card.querySelector('.Button-go')!.addEventListener(
    'click',
    pressed(async () => {
      await allow(
        box.dataset.push!,
        `${box.dataset.at}?push=1`,
        () =>
          said.textContent =
            "This browser's push service did not answer. Trying again in a little while.",
      )
      said.textContent = ''
      await choose(
        { channel: 'push' },
        'Alerts could not be chosen. Try again.',
      )
      leave('on')
    }, 'Alerts could not be turned on. Try again.'),
    { signal },
  )
}

// Whenever the page is seen, now and each time it is shown again, the
// notifications of what was handled since go.
let seen = (root: Document, at: string, signal?: AbortSignal) => {
  let look = () => {
    if (root.visibilityState == 'visible') tidied(at).catch(report)
  }
  look()
  root.addEventListener('visibilitychange', look, { signal })
}

if (typeof document != 'undefined') {
  let page = () => {
    if (document.querySelector('[data-alerts-offer]')) {
      offer(document, leaving(document)).catch(report)
    }
  }
  page()
  document.addEventListener(PAGE, page)
}
