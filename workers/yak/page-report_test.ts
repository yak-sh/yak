// A platform page as a browser runs it: the page the shell draws is parsed
// with linkedom, the reporter its head names runs first, the page's own
// script throws, and what the reporter sends is posted to the apex's door,
// which files it in the tracker tagged with the page.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import { answer, PATH } from './page-report.ts'
import { shell } from './pages.ts'

let reporter = await Deno.readTextFile(
  new URL('./public/report.js', import.meta.url),
)
let at = 'https://yaks.app/manage/ada/chat/new'

// The page drawn around `own`, run: the reporter, then each of the page's own
// scripts, a throw raised at the window as the browser raises it. What the
// reporter sent is returned, as the door would receive it.
let ran = async (own: string) => {
  let html = await shell({}, 'Operator', null, 200, own).text()
  let { document, window } = parseHTML(html)
  let [first, ...rest] = [...document.querySelectorAll('script')]
  let sent: { url: string; body: Blob }[] = []
  Object.defineProperty(document, 'currentScript', { value: first })
  let fetch = () => Promise.resolve(new Response(null, { status: 204 }))
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
    new URL(at),
    { sendBeacon: (url: string, body: Blob) => sent.push({ url, body }) },
    { origin: new URL(at).origin },
    { fetch, console: { error: () => {} } },
    fetch,
    window.addEventListener.bind(window),
    window.removeEventListener.bind(window),
    () => 0,
    () => {},
  )
  for (let script of rest.filter((s) => !s.src)) {
    try {
      new Function(script.textContent ?? '')()
    } catch (error) {
      window.dispatchEvent(Object.assign(new window.Event('error'), {
        error,
        message: (error as Error).message,
        filename: `${at}`,
        lineno: 2,
      }))
    }
  }
  return { first, sent }
}

let filed = async (body: Blob) => {
  let rows: Bundle[][] = []
  let env = {
    ERRORS: {
      send: (sample: Bundle[]) => (rows.push(sample), Promise.resolve()),
    },
  }
  let res = await within(env, {}, () =>
    answer(
      new Request(`https://yaks.app${PATH}`, { method: 'POST', body }),
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
