// The service worker that shows a push (public/push.js), run against a
// worker's globals kept in this process: what it shows, what the icon
// counts, and where pressing one opens.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'

let source = await Deno.readTextFile(
  new URL('./public/push.js', import.meta.url),
)

// A worker with `windows` open, and everything it was asked to do.
let worker = (windows: string[] = []) => {
  let on: Record<string, (event: unknown) => void> = {}
  let did: unknown[][] = []
  let done = (...what: unknown[]) => Promise.resolve(void did.push(what))
  let self = {
    location: { origin: 'https://yaks.app' },
    addEventListener: (name: string, run: (event: unknown) => void) =>
      on[name] = run,
    registration: {
      showNotification: (...args: unknown[]) => done('shown', ...args),
    },
    navigator: {
      setAppBadge: (n: number) => done('badge', n),
      clearAppBadge: () => done('badge', 0),
    },
    clients: {
      matchAll: () =>
        Promise.resolve(windows.map((url) => ({
          url,
          focus: () => done('focus', url),
          navigate: (to: string) => done('navigate', to),
        }))),
      openWindow: (to: string) => done('open', to),
    },
  }
  new Function('self', source)(self)
  let fire = async (name: string, event: object) => {
    let waited: Promise<unknown>[] = []
    on[name]({ ...event, waitUntil: (p: Promise<unknown>) => waited.push(p) })
    await Promise.all(waited)
    return did
  }
  return {
    push: (data: string | null) =>
      fire('push', {
        data: data == null ? null : {
          json: () => JSON.parse(data),
          text: () => data,
        },
      }),
    press: (url: string) =>
      fire('notificationclick', {
        notification: { close: () => {}, data: { url } },
      }),
  }
}

let ask = 'https://yaks.app/manage/ana#ask-e1'

test('a push shows its line, and the icon counts what needs them', async () => {
  let said = { title: 'Ana', body: 'Pick a day.', url: ask, tag: 't', count: 3 }
  assertEquals(await worker().push(JSON.stringify(said)), [
    ['badge', 3],
    ['shown', 'Ana', {
      body: 'Pick a day.',
      tag: 't',
      icon: '/icon-192.png',
      data: { url: ask },
    }],
  ])
  let none = await worker().push(JSON.stringify({ ...said, count: 0 }))
  assertEquals(none[0], ['badge', 0])
})

test('every push shows a notification, even one whose words could not be read', async () => {
  let [broken] = await worker().push('not json')
  let [empty] = await worker().push(null)
  assertEquals(broken.slice(0, 2), ['shown', 'yaks.app'])
  assertEquals((broken[2] as { body: string }).body, 'not json')
  assertEquals((empty[2] as { body: string }).body.length > 0, true)
})

test('pressing one opens the conversation at its ask, in the page’s window when one is open', async () => {
  assertEquals(await worker().press(ask), [['open', ask]])
  assertEquals(
    await worker(['https://yaks.app/settings', 'https://yaks.app/manage/ana'])
      .press(ask),
    [['focus', 'https://yaks.app/manage/ana'], ['navigate', ask]],
  )
})
