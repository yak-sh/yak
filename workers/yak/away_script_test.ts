// Leaving yaks.app (public/away.js), acted on as a person would: a link
// pressed, a form sent to a new tab, and the tab come back to.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'

let code = await Deno.readTextFile(
  new URL('./public/away.js', import.meta.url),
)

let page = (body: string) => {
  let { document } = parseHTML(
    `<!doctype html><html><body>${body}<script data-home="yaks.app"></script></body></html>`,
  )
  let on: Record<string, (e: unknown) => void> = {}
  let reloads = 0
  Object.defineProperty(document, 'currentScript', {
    value: document.querySelector('script'),
  })
  let shown = 'visible'
  Object.defineProperty(document, 'visibilityState', { get: () => shown })
  document.addEventListener =
    ((type: string, fn: (e: unknown) => void) =>
      on[`document ${type}`] = fn) as typeof document.addEventListener
  new Function('document', 'addEventListener', 'location', code)(
    document,
    (type: string, fn: (e: unknown) => void) => on[type] = fn,
    {
      href: 'https://yaks.app/manage/ada/connections',
      hostname: 'yaks.app',
      reload: () => reloads++,
    },
  )
  let link = (href: string, at = '') => {
    let a = document.querySelector(`a[href="${href}"]${at}`)!
    on.click({ target: a, defaultPrevented: false })
    return [a.getAttribute('target'), a.getAttribute('rel')]
  }
  let away = (state: string) => {
    shown = state
    on['document visibilitychange']({})
  }
  return { document, on, link, away, reloads: () => reloads }
}

test('a link off yaks.app opens in a new tab, and one within it stays', () => {
  let hrefs = [
    'https://discord.com/channels/1/2',
    'http://example.com/',
    'https://ada.yaks.app/notes/',
    'https://yaks.app/pricing',
    '/manage/ada/apps',
    'mailto:ada@example.com',
    'tel:+15555550100',
    'sms:+15555550100',
  ]
  let { link } = page(hrefs.map((h) => `<a href="${h}">x</a>`).join(''))
  assertEquals(hrefs.map((h) => link(h)), [
    ['_blank', 'noopener'],
    ['_blank', 'noopener'],
    ...hrefs.slice(2).map(() => [null, null]),
  ])
})

test('a link keeps the rel and target it names', () => {
  let { link } = page(
    '<a href="https://a.test/" rel="nofollow ugc">x</a><a href="https://b.test/" target="_self">y</a>',
  )
  assertEquals(link('https://a.test/'), ['_blank', 'nofollow ugc noopener'])
  assertEquals(link('https://b.test/'), ['_self', null])
})

test('a page whose form went to a new tab is read again once come back to', () => {
  let { document, on, away, reloads } = page(
    '<form><button formtarget="_blank">Connect</button></form><form id="here"><button>Save</button></form>',
  )
  let [there, here] = document.querySelectorAll('form')
  on.submit({ target: here, submitter: here.querySelector('button') })
  away('hidden'), away('visible')
  assertEquals(reloads(), 0)
  on.submit({ target: there, submitter: there.querySelector('button') })
  away('hidden')
  assertEquals(reloads(), 0)
  away('visible')
  assertEquals(reloads(), 1)
})
