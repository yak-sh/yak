// Leaving the page's site (./away.ts), acted on as a person would: a link
// pressed, a form sent to a new tab, and the tab come back to.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { away } from './away.ts'

let page = (body: string) => {
  let { document } = parseHTML(
    `<!doctype html><html><body>${body}</body></html>`,
  )
  let on: Record<string, (e: unknown) => void> = {}
  let reloads = 0
  let shown = 'visible'
  away({
    document: {
      get visibilityState() {
        return shown as DocumentVisibilityState
      },
      addEventListener: ((type: string, fn: (e: unknown) => void) =>
        on[`document ${type}`] = fn) as Document['addEventListener'],
    },
    location: {
      hostname: 'yaks.app',
      reload: () =>
        reloads++,
    },
    addEventListener: (type, fn) => on[type] = fn as (e: unknown) => void,
  }, ['yaks.app'])
  let link = (href: string) => {
    let a = document.querySelector(`a[href="${href}"]`)!
    on.click({ target: a, defaultPrevented: false })
    return [a.getAttribute('target'), a.getAttribute('rel')]
  }
  let leave = (state: string) => {
    shown = state
    on['document visibilitychange']({})
  }
  return { document, on, link, leave, reloads: () => reloads }
}

test('a link off the page site opens in a new tab, and one on it stays', () => {
  let off = [
    'https://discord.com/channels/1/2',
    'http://example.com/',
    'https://ada.yaks.app/notes/',
    '//elsewhere.test/x',
  ]
  let on = [
    'https://yaks.app/pricing',
    'https://www.yaks.app/',
    '/manage/ada/apps',
    'mailto:ada@example.com',
    'tel:+15555550100',
    'sms:+15555550100',
  ]
  let { link } = page(
    [...off, ...on].map((h) => `<a href="${h}">x</a>`).join(''),
  )
  assertEquals([...off, ...on].map(link), [
    ...off.map(() => ['_blank', 'noopener']),
    ...on.map(() => [null, null]),
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
  let { document, on, leave, reloads } = page(
    '<form><button formtarget="_blank">Connect</button></form><form id="here"><button>Save</button></form>',
  )
  let [there, here] = document.querySelectorAll('form')
  on.submit({ target: here, submitter: here.querySelector('button') })
  leave('hidden'), leave('visible')
  assertEquals(reloads(), 0)
  on.submit({ target: there, submitter: there.querySelector('button') })
  leave('hidden')
  assertEquals(reloads(), 0)
  leave('visible')
  assertEquals(reloads(), 1)
})
