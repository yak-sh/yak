// A platform page as a browser runs it: the page the shell draws is parsed
// with linkedom, the reporter its head names runs first, the page's own
// script throws, and what the reporter sends is posted to the apex's door,
// which files it in the tracker tagged with the page, when our own scripts
// threw it and a page of ours sent it.
import { clock, equal, ok, test } from '@yaks/testing'
import { createElement as h } from 'react'
import { Loading } from '@yaks/ui/Loading'
import { retryLoading } from '@yaks/ui/interaction'
import { faultOf } from '@yaks/tracker'
import { parseHTML } from 'linkedom'
import type { Bundle, Comp } from '@yaks/graph'
import { within } from './defects.ts'
import { answer, PATH } from './page-report.ts'
import { shell } from './pages.ts'
import { sheeted } from './sheets.ts'
import { page } from './site/mod.ts'
import { markup } from './html.ts'

let reporter = await Deno.readTextFile(
  new URL('./public/report.js', import.meta.url),
)
let at = 'https://yaks.app/manage/ada/chat/new'

// The page drawn around `own`, run: the reporter, then each of the page's own
// scripts, a throw raised at the window as the browser raises it. What the
// reporter sent is returned, as the door would receive it. A browser names
// where each frame ran (`frame`): our page for its inline scripts, else
// whoever put the script there.
// The reporter run first in `html`, at `page`, with the server answering
// each fetch `status`.
let loaded = (
  html: string,
  page: string,
  status = 204,
  headers: Record<string, string> = {},
  before?: (window: Window) => void,
  read?: (url: string) => Promise<Response>,
) => {
  let { document, window } = parseHTML(html)
  let first = document.querySelector<HTMLScriptElement>(
    'script:not([type=importmap])',
  )!
  let sent: { url: string; body: Blob }[] = []
  let reloads = 0
  Object.defineProperty(document, 'currentScript', { value: first })
  // linkedom resolves no base, and the wrapper reads addresses against it.
  Object.defineProperty(document, 'baseURI', { value: page })
  let time = clock()
  let fetch = (url: string) =>
    read?.(url) ?? Promise.resolve(new Response(null, { status, headers }))
  let scope = {
    fetch,
    console: { error: () => {} },
    MutationObserver: window.MutationObserver,
  }
  if (before) {
    let early = document.querySelector('script[data-yak-early-report]')!
    new Function(
      'globalThis',
      'addEventListener',
      'removeEventListener',
      early.textContent ?? '',
    )(
      scope,
      window.addEventListener.bind(window),
      window.removeEventListener.bind(window),
    )
    before(window as unknown as Window)
  }
  new Function(
    'document',
    'location',
    'navigator',
    'self',
    'globalThis',
    'fetch',
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
    'CustomEvent',
    'setTimeout',
    'clearTimeout',
    reporter,
  )(
    document,
    Object.assign(new URL(page), { reload: () => reloads++ }),
    { sendBeacon: (url: string, body: Blob) => sent.push({ url, body }) },
    { origin: new URL(page).origin },
    scope,
    fetch,
    window.addEventListener.bind(window),
    window.removeEventListener.bind(window),
    window.dispatchEvent.bind(window),
    window.CustomEvent,
    (run: () => void, ms: number) => time.after(ms, run),
    (cancel?: () => void) => cancel?.(),
  )
  return {
    document,
    window,
    first,
    sent,
    time,
    fetch: scope.fetch,
    reloads: () => reloads,
  }
}

let ran = async (own: string, frame = at, page = at) => {
  let html = await shell({}, 'Operator', null, 200, own).text()
  let { document, window, first, sent } = loaded(html, page)
  for (let script of document.querySelectorAll('main script:not([src])')) {
    try {
      new Function(script.textContent ?? '')()
    } catch (error) {
      let { name, message } = error as Error
      Object.assign(error as Error, {
        stack: `${name}: ${message}\n    at ${frame}:2:1`,
      })
      window.dispatchEvent(Object.assign(new window.Event('error'), {
        error,
        message,
        filename: frame,
        lineno: 2,
      }))
    }
  }
  return { first, sent }
}

// What the door files from a body, sent as a page of ours sends it unless
// `headers` say otherwise.
let filed = async (
  body: Blob,
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
) => {
  let rows: Bundle[][] = []
  let env = {
    ERRORS: {
      send: (sample: Bundle[]) => (rows.push(sample), Promise.resolve()),
    },
  }
  let res = await within(env, {}, () =>
    answer(
      new Request(`https://yaks.app${PATH}`, { method: 'POST', body, headers }),
      {},
    ))
  equal(res.status, 204)
  return rows.flat()
}

test('a stuck kit page reports reads and the client error through the platform door and retries in place', async () => {
  let id = crypto.randomUUID()
  let html = await shell(
    { CF_VERSION_METADATA: { id } },
    'Operator',
    null,
    200,
    markup(h('div', {
      'data-yak-loading-stage': 'awaiting the streamed answer',
    }, h(Loading, { state: 'conversation' }, 'Loading conversation…'))),
  ).text()
  let finish = () => {}
  let body = new ReadableStream({
    start: (stream) => {
      finish = () => stream.close()
    },
  })
  let { document, window, fetch, sent, time } = loaded(
    html,
    at,
    200,
    {},
    undefined,
    (url) =>
      url.endsWith('/body')
        ? Promise.resolve(new Response(body))
        : url.endsWith('/done')
        ? Promise.resolve(new Response('done'))
        : new Promise(() => {}),
  )
  let mark = document.querySelector<HTMLElement>('[data-yak-loading]')!
  let retried = 0
  retryLoading(mark, () => retried++)
  void fetch(at + '/headers?token=private')
  let reading = (await fetch(at + '/body')).text()
  equal(await (await fetch(at + '/done')).text(), 'done')
  window.dispatchEvent(Object.assign(new window.Event('unhandledrejection'), {
    reason: Object.assign(Error('A client error'), {
      stack: `Error: A client error\n    at ${at}`,
    }),
  }))
  await time.advance(14_999)
  equal(mark.querySelector('button'), null)
  equal(sent.length, 1)
  await time.advance(1)
  finish()
  await reading
  let [row] = await filed(sent[1].body, {
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (iPhone) Version/27.2 Mobile/15E148 Safari/604.1',
  })
  let error = row.error as Comp
  let exception = row.exception as Comp
  equal(error.commit, id)
  ok(
    String((error.tags as Record<string, string>).agent).includes(
      'Version/27.2',
    ),
  )
  equal(exception.mechanism, 'loading')
  ok(String(exception.cause).includes('A client error'))
  ok(JSON.stringify(row).includes('Loading timed out: conversation'))
  let loading = ((row.breadcrumbs as Comp).items as {
    category: string
    message: string
  }[]).filter((crumb) => crumb.category == 'loading').map((crumb) =>
    crumb.message
  )
  let [reads, stage] = loading
  equal(
    reads,
    'Open reads: GET /manage/ada/chat/new/headers (waiting for headers), GET /manage/ada/chat/new/body (reading response)',
  )
  ok(stage.includes('awaiting the streamed answer'))
  equal(
    mark.querySelector('[data-yak-loading-words]')?.hasAttribute('hidden'),
    true,
  )
  let retry = mark.querySelector('button')!
  equal(retry.textContent, 'Try again')
  retry.click()
  equal(retried, 1)
  equal(
    mark.querySelector('[data-yak-loading-words]')?.hasAttribute('hidden'),
    false,
  )
  mark.remove()
  await time.advance(15_000)
  equal(sent.length, 2)
})

test('a closed fold has no deadline until it opens, and an answered fold stays quiet', async () => {
  let html = await shell(
    {},
    'Operator',
    null,
    200,
    '<details><summary>Details</summary>' +
      markup(h(Loading, { state: 'fold' })) + '</details>',
  ).text()
  let { document, time, sent } = loaded(html, at)
  let fold = document.querySelector('details')!
  await time.advance(15_000)
  equal(sent.length, 0)
  fold.setAttribute('open', '')
  await Promise.resolve()
  await time.advance(14_999)
  fold.querySelector('[data-yak-loading]')!.replaceWith('The fold arrived.')
  await time.advance(1)
  equal(sent.length, 0)
})

test('a hidden conversation starts its deadline when shown and can reload even without an opening module', async () => {
  let html = await shell(
    {},
    'Operator',
    null,
    200,
    markup(h('div', {
      hidden: true,
      'data-yak-loading-stage': 'unbound',
    }, h(Loading, { state: 'conversation' }, 'Loading conversation…'))),
  ).text()
  let { document, sent, time, reloads } = loaded(html, at)
  let slot = document.querySelector('[data-yak-loading-stage]')!
  await time.advance(30_000)
  equal(sent.length, 0)
  slot.removeAttribute('hidden')
  await Promise.resolve()
  await time.advance(14_999)
  equal(sent.length, 0)
  await time.advance(1)
  equal(sent.length, 1)
  ok((await sent[0].body.text()).includes('Stage: unbound'))
  await time.advance(30_000)
  equal(sent.length, 1)
  slot.querySelector('button')!.click()
  equal(reloads(), 1)
})

test('a throw in a platform page reaches the tracker, tagged with the page', async () => {
  let { first, sent } = await ran('<script type="module">m$1()</script>')
  ok(first.src.endsWith('/report.js'), 'the reporter is the first script')
  equal(sent.map((s) => s.url), [`https://yaks.app${PATH}`])
  let [row] = await filed(sent[0].body)
  let error = row.error as { tags: Record<string, string>; message: string }
  equal(error.tags.page, '/manage/ada/chat/new')
  equal(error.tags.request, 'page /manage/ada/chat/new')
  ok(JSON.stringify(row).includes('m$1 is not defined'))
})

test('a break is tagged with the browser that sent it', async () => {
  let safari = 'Mozilla/5.0 (iPhone) Version/18.2 Mobile/15E148 Safari/604.1'
  let [row] = await filed(await sole('<script>m$1()</script>'), {
    'sec-fetch-site': 'same-origin',
    'user-agent': safari,
  })
  equal((row.error as { tags: Record<string, string> }).tags.agent, safari)
})

test('a parser-time throw reaches the tracker when the reporter arrives', async () => {
  let html = await shell({}, 'Operator', null, 200, '').text()
  let { first, sent } = loaded(html, at, 204, {}, (win) => {
    let error = Object.assign(Error('parser-time throw'), {
      stack: `Error: parser-time throw\n    at ${at}:40:1`,
    })
    win.dispatchEvent(
      Object.assign(new (win as Window & typeof globalThis).Event('error'), {
        error,
        filename: at,
        message: error.message,
        lineno: 40,
      }),
    )
  })
  ok(first.hasAttribute('async'))
  equal(sent.length, 1)
  let [row] = await filed(sent[0].body)
  ok(JSON.stringify(row).includes('parser-time throw'))
})

test('the iOS shell is filed from no page, tagged as it says, at its commit', async () => {
  let shell = (tags: object) =>
    filed(
      new Blob([JSON.stringify({
        type: 'shell',
        message: 'no store',
        stack: 'Error: no store\n    at anonymous (main.jsbundle:1:9)',
        cause: 'it has not reopened: 9 attempts',
        mechanism: 'catch',
        page: 'https://yaks.app/manage/ada/operator',
        tags,
      })]),
      {},
    )
  let [row] = await shell({
    variant: 'checks',
    update: 'u1',
    commit: 'c0ffee',
  })
  let error = row.error as {
    tags: Record<string, string>
    commit: string
    exception: { cause: string }
  }
  equal(
    [error.tags.request, error.tags.variant, error.tags.update, error.commit],
    ['shell /manage/ada/operator', 'checks', 'u1', 'c0ffee'],
  )
  ok(JSON.stringify(row).includes('it has not reopened: 9 attempts'))
  equal(await shell({ update: 'u1' }), [])
})

test('a page that does not break sends nothing', async () => {
  equal((await ran('<script>let fine = 1</script>')).sent, [])
})

test('a refusal one of our doors meant is no break', async () => {
  let body = JSON.stringify({
    message: '401 /api/query: sign in',
    url: at,
    status: 401,
    answer: '{"error":"not_signed_in"}',
    mechanism: 'wrapper',
  })
  equal(await filed(new Blob([body])), [])
})

let sole = async (own: string, frame?: string, page?: string) => {
  let { sent } = await ran(own, frame, page)
  equal(sent.length, 1)
  return sent[0].body
}

test('a throw that is not our scripts is dropped quietly', async () => {
  let throws = '<script>m$1()</script>'
  let extension = 'chrome-extension://abcdefghijklmnop/content.js'
  equal(await filed(await sole(throws, extension)), [], 'an extension')
  let muted = JSON.stringify({ message: 'Script error.', url: at, stack: '' })
  equal(await filed(new Blob([muted])), [], 'a muted script error')
})

test('a post no page of ours sent is dropped quietly', async () => {
  let body = await sole('<script>m$1()</script>')
  equal(await filed(body, {}), [], 'no origin')
  equal(
    await filed(body, { origin: 'https://evil.test' }),
    [],
    'another origin',
  )
  equal((await filed(body, { origin: 'https://yaks.app' })).length > 0, true)
})

test('the same throw on another page is the same bug', async () => {
  let throws = '<script>m$1()</script>'
  let other = 'https://yaks.app/manage/eli/chat/new'
  let [one] = await filed(await sole(throws))
  let [two] = await filed(await sole(throws, other, other))
  equal(faultOf(two), faultOf(one))
})

test('the home page files a throw and a frame that will not load, tagged with it', async () => {
  let home = page('index.html')
  let { document, window, first, sent } = loaded(
    sheeted(home, {}).body,
    'https://yaks.app/',
    404,
  )
  ok(first.src.endsWith('/report.js'), 'the reporter is the first script')
  let error = Object.assign(Error('boom'), {
    stack: 'Error: boom\n    at start (https://yaks.app/wander.js:90:3)',
  })
  window.dispatchEvent(Object.assign(new window.Event('error'), {
    error,
    message: 'boom',
    filename: 'https://yaks.app/wander.js',
    lineno: 90,
  }))
  let frame = document.createElement('img')
  frame.src = 'https://yaks.app/mascot/wander-down-128.webp'
  document.body.append(frame)
  // A load that fails is raised at its element, which the browser hands the
  // window's listener as the event's target.
  let missed = new window.Event('error')
  Object.defineProperty(missed, 'target', { get: () => frame, set: () => {} })
  window.dispatchEvent(missed)
  await new Promise((done) => setTimeout(done, 0))
  let rows = (await Promise.all(sent.map((s) => filed(s.body)))).flat()
  let errors = rows.map((r) =>
    r.error as { tags: Record<string, string>; message?: string }
  )
  equal(errors.map((e) => e.tags.page), ['/', '/'])
  let said = JSON.stringify(rows)
  ok(said.includes('boom'))
  ok(said.includes('failed to load img https://yaks.app/mascot/wander-down'))
})

test('a platform page whose module will not link is filed, placed where it broke', async () => {
  let html = await shell({}, 'Operator', null, 200, '').text()
  let { window, sent } = loaded(html, at)
  // Chrome's SyntaxError for an import its module lacks names no frame, and
  // the specifier is relative: nothing in its stack is on the apex.
  let error = new SyntaxError(
    "The requested module './answer.js' does not provide an export named 'show'",
  )
  error.stack = `SyntaxError: ${error.message}`
  window.dispatchEvent(Object.assign(new window.Event('error'), {
    error,
    message: error.message,
    filename: 'https://yaks.app/manage/chat.js',
    lineno: 1,
  }))
  let [row] = await filed(sent[0].body)
  let filedAs = row.error as { tags: Record<string, string> }
  equal(filedAs.tags.page, '/manage/ada/chat/new')
})

test('an answer saying the store moved is told to the page’s client', async () => {
  let html = await shell({}, 'Operator', null, 200, '').text()
  let heard = (headers: Record<string, string>) => {
    let { window, fetch } = loaded(html, at, 200, headers)
    let told: string[] = []
    window.addEventListener(
      'yak-moved',
      (e: Event) => told.push((e as CustomEvent).detail),
    )
    return { fetch, told }
  }
  let moved = heard({ 'x-yak-moved': '1' })
  await moved.fetch('https://yaks.app/pavilion/request')
  await moved.fetch('https://elsewhere.test/pavilion/request')
  equal(moved.told, ['https://yaks.app/pavilion/request'])
  let still = heard({})
  await still.fetch('https://yaks.app/pavilion/request')
  equal(still.told, [])
})
