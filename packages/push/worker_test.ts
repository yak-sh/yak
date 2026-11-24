// The service worker that shows a push (worker.js), run against a worker's
// globals kept in this process: what it shows and takes away, what the icon
// counts, where pressing one opens, and what pressing a button sends.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { closing, refreshed, said } from './notice.ts'

let source = await Deno.readTextFile(new URL('./worker.js', import.meta.url))
type Shown = { title?: string; tag?: string; body?: string; data?: object }

// A worker with `windows` open and `shown` notifications, answering a post
// with `posted`, and everything it was asked to do.
let worker = (
  {
    windows = [] as string[],
    shown = [] as (string | Shown)[],
    posted = 303,
    handled = [] as string[],
    inaccessible = false,
  } = {},
) => {
  let on: Record<string, (event: unknown) => void> = {}
  let did: unknown[][] = []
  let done = (...what: unknown[]) => Promise.resolve(void did.push(what))
  let visible = shown.map((n) => typeof n == 'string' ? { tag: n } : n)
  let self = {
    location: { origin: 'https://yaks.app' },
    addEventListener: (name: string, run: (event: unknown) => void) =>
      on[name] = run,
    registration: {
      // Keep same-tag notifications separate, as WebKit can do.
      showNotification: (title: string, options: Omit<Shown, 'title'>) => {
        visible.push({ title, ...options })
        return done('shown', title, options)
      },
      getNotifications: ({ tag }: { tag?: string } = {}) =>
        inaccessible
          ? Promise.reject(new Error('Notifications are unavailable'))
          : Promise.resolve(
            visible.filter((n) => !tag || n.tag == tag).map((n) => ({
              ...n,
              close: () => {
                visible.splice(visible.indexOf(n), 1)
                did.push(['closed', n.tag])
              },
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
    if (new URL(url).searchParams.has('handled')) {
      return Promise.resolve(Response.json({ handled }))
    }
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
    visible: () => visible.map((n) => n.title ?? n.tag),
    declarative: async (data: string) => {
      let wire = JSON.parse(data)
      try {
        return await fire('push', {
          data: null,
          notification: wire.notification,
          appBadge: Number(wire.app_badge),
        })
      } catch {
        visible.push(wire.notification)
        did.push(['fallback', wire.notification.title])
        return did
      }
    },
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

let updates = 'https://yaks.app/ana/updates'
let cleared = {
  title: '1 dismissed',
  body: '',
  url: updates,
  icon: notice.icon,
  badge: notice.badge,
}
let check = 'https://yaks.app/manage/ana/operator?handled=1'

test('Safari closes the handled row and silently re-shows one waiting notification unchanged', async () => {
  let waiting = {
    ...notice,
    tag: 'd2',
    data: { url: ask, badge: notice.badge },
  }
  let safari = worker({ shown: ['d1', waiting, 'd3'] })
  assertEquals(await safari.declarative(refreshed(waiting, 'd1', false, 1)), [
    ['badge', 1],
    ['closed', 'd1'],
    ['closed', 'd2'],
    ['shown', waiting.title, {
      body: waiting.body,
      tag: waiting.tag,
      renotify: false,
      silent: true,
      navigate: ask,
      icon: notice.icon,
      badge: notice.badge,
      actions: [],
      data: { url: ask, actions: [], badge: notice.badge, dismissed: ['d1'] },
    }],
  ])
  assertEquals(safari.visible(), ['d3', waiting.title])
})

test('Safari displays one silent dismissal count, including when pushes arrive together', async () => {
  let safari = worker({ shown: ['d1', 'd2'] })
  await safari.push(refreshed(notice, 'd1', false, 0))
  await Promise.all(
    ['d2', 'd3', 'd4', 'd5', 'd5'].map((tag) =>
      safari.push(refreshed(cleared, tag, true, 0))
    ),
  )
  assertEquals(safari.visible(), ['5 dismissed'])
  await safari.push(said(notice, 1, check))
  assertEquals(safari.visible(), [notice.title])
  let did = await safari.push(refreshed(cleared, 'd1', true, 0))
  assertEquals(safari.visible(), ['1 dismissed'])
  assertEquals(did.at(-1), ['shown', '1 dismissed', {
    body: '',
    tag: undefined,
    renotify: false,
    silent: true,
    navigate: updates,
    icon: notice.icon,
    badge: notice.badge,
    actions: [],
    data: { url: updates, actions: [], badge: notice.badge, dismissed: ['d1'] },
  }])
  let clicked = await safari.press({ url: updates })
  assertEquals(clicked.at(-1), ['open', updates])
})

test('a new Safari push closes older handled rows while retaining waiting rows', async () => {
  let safari = worker({ shown: ['d1', 'd2', 'd3'], handled: ['d2'] })
  let did = await safari.push(said(notice, 1, check))
  assertEquals(did.at(-2), ['post', check, '["d2","d3"]'])
  assertEquals(did.at(-1), ['closed', 'd2'])
  assertEquals(safari.visible(), ['d3', notice.title])
})

test('Safari has a declarative fallback if the worker cannot read its notifications', async () => {
  let safari = worker({ inaccessible: true })
  let push = refreshed(notice, 'd1', false, 1)
  let fallback = JSON.parse(push).notification
  assertEquals([fallback.silent, fallback.navigate, fallback.tag], [
    true,
    ask,
    notice.tag,
  ])
  let did = await safari.declarative(push)
  assertEquals(did.at(-1), ['fallback', notice.title])
  assertEquals(safari.visible(), [notice.title])
})

test('a dismissal sent before a new alert preserves it when the pushes arrive out of order', async () => {
  let newer = { ...notice, tag: 'd2', data: { url: ask } }
  let safari = worker({ shown: ['d1', newer] })
  let did = await safari.declarative(refreshed(cleared, 'd1', true, 0, check))
  assertEquals(did.at(-2), ['closed', 'd2'])
  assertEquals(safari.visible(), [newer.title])
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
