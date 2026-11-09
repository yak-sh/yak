// The side's fold (public/side.js, sidebar.ts `fold`), pressed as a person
// would on a dashboard page: the side collapses to its icons at once and the
// choice is sent to be kept; pressed again it opens. Where it could not be
// sent, the form goes as it would without the script.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { desk } from './desk-pages.ts'

let code = await Deno.readTextFile(
  new URL('./public/side.js', import.meta.url),
)

let page = async (answers = true) => {
  let html = await desk({ space: 'dana', apps: [], name: 'dana' }, {}).text()
  let { document } = parseHTML(html)
  let on: Record<string, (e: unknown) => Promise<void>> = {}
  let sent: string[] = []
  new Function('document', 'addEventListener', 'fetch', code)(
    document,
    (type: string, fn: (e: unknown) => Promise<void>) => on[type] = fn,
    (_to: string, init: { body: URLSearchParams }) => (
      sent.push(init.body.get('sidebar')!),
        answers
          ? Promise.resolve({ ok: true })
          : Promise.reject(new TypeError('offline'))
    ),
  )
  let form = document.querySelector('form[data-side]')! as HTMLFormElement
  let submitted = 0
  form.submit = () => void submitted++
  let button = form.querySelector('button')!
  return {
    html,
    sent,
    submitted: () => submitted,
    press: () => on.submit({ target: button, preventDefault() {} }),
    rail: () => [
      document.body.classList.contains('Desk-rail'),
      document.getElementById('menu')!.classList.contains('Sidebar-rail'),
    ],
    navs: () =>
      [...document.querySelectorAll('#menu .SideNav')].map((n) =>
        n.classList.contains('SideNav-rail')
      ),
    said: () => [button.getAttribute('aria-label'), button.title],
    expanded: () => button.getAttribute('aria-expanded'),
  }
}

test('the page with a fold loads its script', async () => {
  assert((await page()).html.includes('/side.js'))
})

test('the fold collapses the side to its icons, then opens it', async () => {
  let p = await page()
  assertEquals([p.rail(), p.expanded()], [[false, false], 'true'])
  await p.press()
  assertEquals(p.rail(), [true, true])
  assert(p.navs().every(Boolean))
  assertEquals(p.expanded(), 'false')
  assertEquals(p.said(), ['Expand the sidebar', 'Expand the sidebar'])
  await p.press()
  assertEquals(p.rail(), [false, false])
  assert(!p.navs().some(Boolean))
  assertEquals(p.said(), ['Collapse the sidebar', 'Collapse the sidebar'])
  assertEquals(p.sent, ['collapsed', 'open'])
  assertEquals(p.submitted(), 0)
})

test('a fold that could not be sent is sent as the form', async () => {
  let p = await page(false)
  await p.press()
  assertEquals(p.submitted(), 1)
})
