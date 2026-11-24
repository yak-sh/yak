// Push on the device a person is holding: allowing a browser's
// notifications and subscribing it, the installed app's icon count, and
// taking away the notifications on this device whose thing was handled.

/** The browser cannot be subscribed, for a reason its person can act on;
 * its message says what to do. */
export class Unallowed extends Error {
  override name = 'Unallowed'
}

// How long to wait before each new try when the browser's push service
// refuses a subscription.
let WAITS = [10_000, 60_000, 300_000]

/** Runs `attempt` again, after each of `waits`, while the browser's push
 * service refuses it. Chrome answers `AbortError` ("Registration failed -
 * push service error") when its push service cannot register the browser for
 * a while; a bad key would be an `InvalidAccessError` instead. `waiting` is
 * called once, at the first refusal, so the page can say it will try again. */
export let persist = async <T>(
  attempt: () => Promise<T>,
  {
    waits = WAITS,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    waiting,
  }: {
    waits?: number[]
    sleep?: (ms: number) => Promise<void>
    waiting?: () => void
  } = {},
): Promise<T> => {
  for (let i = 0;; i++) {
    try {
      return await attempt()
    } catch (error) {
      if ((error as Error)?.name != 'AbortError') throw error
      if (i == waits.length) {
        throw new Unallowed(
          "This browser's push service is not answering. Try again later.",
        )
      }
      if (i == 0) waiting?.()
      await sleep(waits[i])
    }
  }
}

/** Allows notifications on this browser and subscribes it: asks its
 * permission, registers the service worker at `worker` (worker.js, served
 * by the host) and subscribes with the site's public VAPID `key`. Call it
 * from a press: a browser asks only then. While the push service refuses,
 * it tries again later (`persist`), calling `waiting` once. */
export let subscribe = async (
  key: string,
  { worker = '/push.js', waiting }: { worker?: string; waiting?: () => void } =
    {},
): Promise<PushSubscription> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
    throw new Unallowed(
      'This browser cannot show notifications. Choose another way.',
    )
  }
  if (await Notification.requestPermission() != 'granted') {
    throw new Unallowed(
      'Notifications are blocked for this site in this browser. Allow them in its settings, then try again.',
    )
  }
  let registered = await navigator.serviceWorker.register(worker)
  await navigator.serviceWorker.ready
  let server = Uint8Array.from(
    atob(key.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )
  return await registered.pushManager.getSubscription() ??
    await persist(() =>
      registered.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: server,
      }), { waiting })
}

/** The installed app's icon shows `count` things waiting, or none. */
export let badge = (count: number) => {
  let shown = count > 0
    ? navigator.setAppBadge?.(count)
    : navigator.clearAppBadge?.()
  shown?.catch(() => {})
}

/** Takes away this device's notifications whose thing was read or
 * answered since they came: `handled` is asked which of the tags shown are,
 * and those close. A page calls it as it is seen, which is how they leave a
 * device that is never pushed a closing (notice.ts `quietly`). */
export let tidy = async (
  handled: (tags: string[]) => Promise<string[]>,
): Promise<void> => {
  if (!('serviceWorker' in navigator)) return
  let registered = await navigator.serviceWorker.getRegistration('/')
  let shown = (await registered?.getNotifications() ?? []).filter((n) => n.tag)
  if (!shown.length) return
  let gone = new Set(await handled([...new Set(shown.map((n) => n.tag))]))
  shown.filter((n) => gone.has(n.tag)).forEach((n) => n.close())
}
