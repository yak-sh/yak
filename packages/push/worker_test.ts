// The service worker that shows a push (worker.js), run against a worker's
// globals kept in this process: what it shows and takes away, what the icon
// counts, where pressing one opens, and what pressing a button sends.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { closing, said } from './notice.ts'

let source = await Deno.readTextFile(new URL('./worker.js', import.meta.url))

// A worker with `windows` open and `shown` notifications, answering a post
// with `posted`, and everything it was asked to do.
let worker = (
  { windows = [] as string[], shown = [] as string[], posted = 303 } = {},
) => {
  let on: Record<string, (event: unknown) => void> = {}
  let did: unknown[][] = []
  let done = (...what: unknown[]) => Promise.resolve(void did.push(what))
  let self = {
    location: { origin: 'https://yaks.app' },
    addEventListener: (name: string, run: (event: unknown) => void) =>
      on[name] = run,
    registration: {
      showNotification: (...args: unknown[]) => done('shown', ...args),
      getNotifications: ({ tag }: { tag: string }) =>
        Promise.resolve(
          shown.filter((t) => t == tag).map((t) => ({
            close: () => did.push(['closed', t]),
          })),
        ),
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
  let fetch = (url: string, init: RequestInit) => {
    did.push(['post', url, String(init.body)])
    return Promise.resolve(
      posted == 303
        ? { ok: false, type: 'opaqueredirect' }
        : { ok: posted < 300, type: 'basic' },
    )
  }
  new Function('self', 'fetch', source)(self, fetch)
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
    press: (data: object, action = '') =>
      fire('notificationclick', {
        action,
        notification: { close: () => did.push(['closed']), data },
      }),
  }
}

let ask = 'https://yaks.app/manage/ana#ask-e1'
let notice = {
  title: 'Elihu needs your OK',
  body: 'Email bo@x.com?',
  tag: 'd1',
  url: ask,
  icon: 'https://yaks.app/manage/ana/logo/a?size=icon',
  badge: 'https://yaks.app/badge-96.png',
  actions: [{
    action: 'Approve',
    title: 'Approve',
    post: 'https://yaks.app/ana/updates',
    form: { choose: 'd1', choice: 'Approve' },
  }],
}

test('a push shows its notification, replacing one of its tag, and the icon counts what needs them', async () => {
  assertEquals(await worker().push(said(notice, 3)), [
    ['badge', 3],
    ['shown', 'Elihu needs your OK', {
      body: 'Email bo@x.com?',
      tag: 'd1',
      renotify: true,
      icon: notice.icon,
      badge: notice.badge,
      actions: [{ action: 'Approve', title: 'Approve' }],
      data: { url: ask, actions: notice.actions },
    }],
  ])
  let none = await worker().push(said(notice, 0))
  assertEquals(none[0], ['badge', 0])
})

test('every push that is not a closing shows a notification, even one whose words could not be read', async () => {
  let [broken] = await worker().push('not json')
  let [empty] = await worker().push(null)
  assertEquals(broken[0], 'shown')
  assertEquals((broken[2] as { body: string }).body, 'not json')
  assertEquals((empty[2] as { body: string }).body.length > 0, true)
})

test('a closing takes away the notifications of its tags and sets the count', async () => {
  assertEquals(
    await worker({ shown: ['d1', 'd2'] }).push(closing(['d1'], 1)),
    [['badge', 1], ['closed', 'd1']],
  )
})

test('pressing one opens where it points, in the page’s window when one is open', async () => {
  assertEquals(await worker().press({ url: ask }), [['closed'], ['open', ask]])
  assertEquals(
    await worker({
      windows: ['https://yaks.app/settings', 'https://yaks.app/manage/ana'],
    }).press({ url: ask }),
    [['closed'], ['focus', 'https://yaks.app/manage/ana'], ['navigate', ask]],
  )
})

test('pressing a button posts its form, and opens its notification when that fails', async () => {
  let data = { url: ask, actions: notice.actions }
  let post = [
    'post',
    'https://yaks.app/ana/updates',
    'choose=d1&choice=Approve',
  ]
  assertEquals(await worker().press(data, 'Approve'), [['closed'], post])
  assertEquals(await worker({ posted: 500 }).press(data, 'Approve'), [
    ['closed'],
    post,
    ['open', ask],
  ])
})
