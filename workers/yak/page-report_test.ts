// A platform page as a browser runs it: the page the shell draws is parsed
// with linkedom, the reporter its head names runs first, the page's own
// script throws, and what the reporter sends is posted to the apex's door,
// which files it in the tracker tagged with the page, when our own scripts
// threw it and a page of ours sent it.
import { equal, ok, test } from '@yaks/testing'
import { faultOf } from '@yaks/tracker'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import { answer, PATH } from './page-report.ts'
import { shell } from './pages.ts'
import { sheeted } from './sheets.ts'
import { page } from './site/mod.ts'

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
let loaded = (html: string, page: string, status = 204) => {
  let { document, window } = parseHTML(html)
  let [first, ...rest] = [...document.querySelectorAll('script')]
  let sent: { url: string; body: Blob }[] = []
  Object.defineProperty(document, 'currentScript', { value: first })
  let fetch = () => Promise.resolve(new Response(null, { status }))
  new Function(
    'document',
    'location',
    'navigator',
    'self',
    'globalThis',
    'fetch',
    'addEventListener',
    'removeEventListener',
    'setTimeout',
    'clearTimeout',
    reporter,
  )(
    document,
    new URL(page),
    { sendBeacon: (url: string, body: Blob) => sent.push({ url, body }) },
    { origin: new URL(page).origin },
    { fetch, console: { error: () => {} } },
    fetch,
    window.addEventListener.bind(window),
    window.removeEventListener.bind(window),
    () => 0,
    () => {},
  )
  return { document, window, first, rest, sent }
}

let ran = async (own: string, frame = at, page = at) => {
  let html = await shell({}, 'Operator', null, 200, own).text()
  let { window, first, rest, sent } = loaded(html, page)
  for (let script of rest.filter((s) => !s.src)) {
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
    sheeted(home, {}),
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
