import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { picture } from './picture.ts'

// The bootstrap of a picture (or a shell), run over a window that answers
// its fetch with `answer`: what it wrote over the picture, what it told the
// tracker, what it told its worker, and whether it loaded again. `later`
// runs every timer it set.
let opened = (
  answer: () => Promise<Response>,
  o: { shell?: boolean; offline?: boolean; file?: Response } = {},
) => {
  let html = picture(
    '<!doctype html><html><head></head><body><p>kept</p></body></html>',
    1,
    { door: '/api/report', shell: o.shell },
  )
  let boot = /<script>([\s\S]*?)<\/script>/.exec(html)![1]
  let said = { written: '', told: [] as string[], network: [] as string[] }
  let reloads = 0
  let timers: (() => void)[] = []
  let retry = { type: '', textContent: '', style: {}, onclick: () => {} }
  let status = {
    textContent: '',
    replaceChildren: (words: string) => void (status.textContent = words),
  }
  let document = {
    documentElement: {
      hasAttribute: (a: string) => a == 'data-kept-shell' && !!o.shell,
      getAttribute: () => '1',
    },
    readyState: 'interactive',
    visibilityState: 'visible',
    createElement: () => retry,
    querySelector: () => status,
    open: () => {},
    write: (h: string) => void (said.written += h),
    close: () => {},
  }
  let navigator = {
    onLine: !o.offline,
    sendBeacon: (_: string, b: Blob) => {
      void b.text().then((t) => said.told.push(JSON.parse(t).message))
      return true
    },
    serviceWorker: {
      controller: {
        postMessage: (m: { network: string }, [port]: MessagePort[]) => {
          said.network.push(m.network)
          port.postMessage(true)
        },
      },
    },
  }
  let location = {
    href: 'https://yaks.app/manage/chat',
    origin: 'https://yaks.app',
    reload: () => void reloads++,
  }
  let fetch = (at: string) =>
    at == location.href ? answer() : Promise.resolve(o.file ?? new Response(''))
  new Function(
    'document',
    'navigator',
    'location',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'history',
    boot,
  )(
    document,
    navigator,
    location,
    fetch,
    (f: () => void) => timers.push(f),
    () => {},
    { replaceState: () => {} },
  )
  let settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((on) => setTimeout(on, 0))
  }
  return {
    said,
    status,
    retry,
    reloads: () => reloads,
    settle,
    later: async () => {
      for (let f of timers.splice(0)) f()
      await settle()
    },
  }
}

let html = (body: string, status = 200) => () =>
  Promise.resolve(
    new Response(body, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  )

test('a picture is written over by its page as it is now, and loads nothing again', async () => {
  let o = opened(html('<p>now</p>'))
  await o.settle()
  await o.later()
  assertEquals([o.said.written, o.reloads(), o.said.told], [
    '<p>now</p>',
    0,
    [],
  ])
})

test('a picture whose page answers as no page tells why and loads once from the network', async () => {
  let o = opened(html('down', 503))
  await o.settle()
  assertEquals(o.said, {
    written: '',
    told: ['A kept picture fell back to the network: answered 503'],
    network: ['https://yaks.app/manage/chat'],
  })
  assertEquals(o.reloads(), 1)
})

test('a missing fresh stylesheet keeps the picture until the fallback navigation', async () => {
  let o = opened(
    html(
      '<head><link rel="stylesheet" href="/_yak/release.css"></head><body>new</body>',
    ),
    { file: new Response('gone', { status: 404 }) },
  )
  await o.settle()
  assertEquals(o.said, {
    written: '',
    told: [
      'A kept picture fell back to the network: threw A file the page needs answered 404 at /_yak/release.css',
    ],
    network: ['https://yaks.app/manage/chat'],
  })
  assertEquals(o.reloads(), 1)
})

test('a picture keeps waiting for a slow answer and replaces itself when it comes', async () => {
  let response = Promise.withResolvers<Response>()
  let o = opened(() => response.promise)
  await o.later()
  assertEquals(o.status.textContent, 'This is taking longer than usual. ')
  assertEquals(o.reloads(), 0)
  response.resolve(await html('<p>at last</p>')())
  await o.settle()
  assertEquals(o.said.written, '<p>at last</p>')
  assertEquals(o.said.told, [])
})

test('the reload button on a stalled picture asks the network once', async () => {
  let o = opened(() => new Promise(() => {}))
  await o.later()
  o.retry.onclick()
  o.retry.onclick()
  await o.settle()
  assertEquals(o.said.network, ['https://yaks.app/manage/chat'])
  assertEquals(o.reloads(), 1)
})

test('offline, a picture stays and says when it was taken, and a shell, with nothing of its own, loads again', async () => {
  let gone = () => Promise.reject(new TypeError('Load failed'))
  let kept = opened(gone, { offline: true })
  await kept.settle()
  await kept.later()
  assertEquals(kept.reloads(), 0)
  assertEquals(kept.status.textContent.startsWith('Offline.'), true)
  let shell = opened(gone, { shell: true, offline: true })
  await shell.settle()
  assertEquals(shell.said.told, [
    'A kept shell fell back to the network: offline',
  ])
  assertEquals(shell.reloads(), 1)
})
