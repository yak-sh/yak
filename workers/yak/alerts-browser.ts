// Alerts on the device a person is holding (operator-alerts.ts): allowing a
// browser's notifications, the offer in the conversation that does it in one
// press (operator-page.ts `alertsOffer`), and the installed page's icon
// showing how many things need them. Apple delivers web push only to a page
// added to an iPhone's Home Screen, after a press there, so in an iPhone's
// browser the offer says to add it first.
import { CallError } from '@yaks/tools/errors'

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

/** Allows notifications on this browser: asks its permission, registers the
 * worker that shows them (public/push.js), subscribes with yaks.app's public
 * VAPID `key` and keeps the subscription at `at` (operator-page.ts `?push`).
 * Call it from the press itself: a browser asks only then. */
export let allow = async (key: string, at: string) => {
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
    throw new CallError(
      'arguments',
      'This browser cannot show notifications. Choose another way.',
    )
  }
  if (await Notification.requestPermission() != 'granted') {
    throw new CallError(
      'arguments',
      'Notifications are blocked for yaks.app in this browser. Allow them in its settings, then try again.',
    )
  }
  let worker = await navigator.serviceWorker.register('/push.js')
  await navigator.serviceWorker.ready
  let server = Uint8Array.from(
    atob(key.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )
  let sub = await worker.pushManager.getSubscription() ??
    await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: server,
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

/** The installed page's icon shows `count` things waiting, or none. */
export let badge = (count: number) => {
  let shown = count > 0
    ? navigator.setAppBadge?.(count)
    : navigator.clearAppBadge?.()
  shown?.catch(() => {})
}

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

/** The offer of alerts on this device, as `alertsOffer` drew it: each of its
 * parts hidden until this device is known. A device that already brings them
 * shows nothing; an iPhone's browser says to add the page to the Home Screen;
 * one that can be allowed offers the press, which allows it and chooses
 * notifications as the way the person is alerted. */
export let offer = async (root: Document = document) => {
  let box = root.querySelector<HTMLElement>('[data-alerts-offer]')
  if (!box) return
  if (box.dataset.badge) badge(Number(box.dataset.badge))
  let part = (name: string) =>
    box.querySelector<HTMLElement>(`[data-shows=${name}]`)!
  let show = (name: string) => part(name).hidden = false
  if (apple() && !installed()) return show('install')
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) return
  if (Notification.permission == 'denied') return
  if (await alerting(box.dataset.on != null)) return
  show('offer')
  let press = part('offer').querySelector<HTMLButtonElement>('button')!
  let said = part('offer').querySelector<HTMLElement>('[data-status]')!
  press.addEventListener('click', async () => {
    press.disabled = true
    said.textContent = ''
    try {
      await allow(box.dataset.push!, `${box.dataset.at}?push=1`)
      let response = await fetch(`${box.dataset.at}?alerts=1`, {
        method: 'POST',
        body: new URLSearchParams({ channel: 'push' }),
      })
      if (!response.ok) {
        throw await refusal(response, 'Alerts could not be chosen. Try again.')
      }
      part('offer').hidden = true
      show('on')
      part('on').addEventListener('animationend', () => box.remove())
    } catch (error) {
      if (!(error instanceof CallError)) report(error)
      said.textContent = error instanceof CallError
        ? error.message
        : 'Alerts could not be turned on. Try again.'
    }
    press.disabled = false
  })
}

if (typeof document != 'undefined') offer().catch(report)
