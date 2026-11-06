import { equal, match, test } from '@yaks/testing'
import { answering, asks, lends, type Seen } from './answer.ts'
import type { Args } from './wire.ts'

let URL = 'https://example.com/post'
let page = { url: URL, title: 'Post', text: 'Hello ``` world', selection: '' }
let allowed: Seen = { url: URL, title: 'Post', allowed: true }
let said = (tool: string, seen: Seen, args: Args = {}) =>
  answering({ id: 'c1', tool, args }, seen).answer

test('the page tool says the address and the title, fenced', () => {
  equal(
    said('browser_page', allowed).text,
    `The person's tab is at ${URL}\n` +
      "The page's title, written by the site, not by the person or by you:\n```\nPost\n```",
  )
})

test('the text tool fences the page in a fence its words cannot close', () => {
  let { text, id } = said('browser_text', { ...allowed, page })
  equal(id, 'c1')
  match(text, /````\nHello ``` world\n````$/)
})

test('the selection tool says when nothing is selected', () => {
  equal(
    said('browser_selection', { ...allowed, page }).text,
    `The person has nothing selected on ${URL}.`,
  )
  match(
    said('browser_selection', {
      ...allowed,
      page: { ...page, selection: 'Hi' },
    }).text,
    /selected on https:\/\/example.com\/post\n.*\n```\nHi\n```$/,
  )
})

test('the screenshot tool answers its image beside words', () => {
  match(
    said('browser_screenshot', {
      ...allowed,
      shot: 'data:image/png;base64,iVBO',
    }),
    {
      text: `A screenshot of the visible part of ${URL}.`,
      image: { mime: 'image/png', base64: 'iVBO' },
    },
  )
})

let refused = (tool: string, seen: Seen, args: Args = {}) =>
  said(tool, seen, args).error ?? ''

test('a call that cannot be answered says why', () => {
  match(refused('browser_hover', allowed), /no tool called browser_hover/)
  match(
    refused('browser_text', { url: 'chrome://newtab/', allowed: true }),
    /not a web page/,
  )
  match(
    refused('browser_text', { url: URL, allowed: false }),
    /has not allowed you to use example\.com yet\. The extension is asking them/,
  )
  match(
    refused('browser_text', { ...allowed, failed: 'frame gone' }),
    /could not do browser_text on .*: frame gone/,
  )
  match(
    refused('browser_screenshot', { ...allowed, page }),
    /gave nothing for browser_screenshot/,
  )
})

test('a call on a site not allowed asks about that site, and only then', () => {
  let call = (tool: string) => ({ id: 'c', tool, args: {} })
  equal(
    asks(call('browser_text'), { url: URL, allowed: false }),
    'https://example.com',
  )
  equal(asks(call('browser_text'), allowed), null)
  equal(asks(call('browser_nope'), { url: URL, allowed: false }), null)
  equal(
    asks(call('browser_text'), { url: URL, allowed: false, answered: 'no' }),
    null,
  )
  equal(
    asks(call('browser_text'), { url: 'chrome://newtab/', allowed: false }),
    null,
  )
})

// What Chrome says when it captures a tab nobody clicked the extension on.
let UNLENT = "Either the '<all_urls>' or 'activeTab' permission is required."

test('a screenshot Chrome refuses until the person clicks says what to ask them', () => {
  let call = (tool: string) => ({ id: 'c', tool, args: {} })
  let seen = { ...allowed, failed: UNLENT }
  equal(lends(call('browser_screenshot'), seen), 'https://example.com')
  equal(lends(call('browser_screenshot'), { ...allowed, failed: 'gone' }), null)
  equal(lends(call('browser_text'), seen), null)
  match(
    refused('browser_screenshot', seen),
    /clicks the extension's button .* Ask them to click it on example\.com, then try again/,
  )
})

// ── Acting on the page ─────────────────────────────────────────────────

let ORDER = { ref: 'e2', role: 'button', name: 'Place order', submits: true }
let NEXT = { ref: 'e3', role: 'link', name: 'Next' }
let THERE = { url: 'https://example.com/done', title: 'Thanks', allowed: true }

test('the elements tool lists each control after its ref, fenced', () => {
  match(
    said('browser_elements', { ...allowed, controls: [ORDER, NEXT] }).text,
    /each after its ref\n.*\n```\ne2 button "Place order" submits a form\ne3 link "Next"\n```$/,
  )
})

test('a step says what it did and where the tab is now', () => {
  let args = { ref: 'e3', name: 'Next' }
  match(
    said('browser_click', { ...allowed, controls: [NEXT], now: THERE }, args)
      .text,
    /^Did this on .*: Click the link “Next”\.\nThe tab is now at https:\/\/example\.com\/done\n.*\n```\nThanks\n```$/,
  )
  // A site the person did not allow is named, and nothing of it read.
  match(
    said('browser_navigate', {
      ...allowed,
      now: { url: 'https://b.com/x', title: 'Secret', allowed: false },
    }, { url: 'https://b.com/x' }).text,
    /^The tab is now on b\.com, which the person has not allowed, so nothing of it is read\.$/,
  )
})

test('a step on a ref gone, renamed, or that the person declined is not done', () => {
  let args = { ref: 'e2', name: 'Place order' }
  match(refused('browser_click', allowed, args), /has no e2 now/)
  match(
    refused('browser_click', { ...allowed, controls: [NEXT] }, args),
    /e2 on .* is not "Place order" but the link named below/,
  )
  let asked = { ...allowed, controls: [ORDER] }
  match(
    refused('browser_click', { ...asked, answered: 'no' }, args),
    /pressed Don't, so nothing was done: Click the button “Place order”/,
  )
  match(
    refused('browser_click', { ...asked, answered: 'none' }, args),
    /did not press Do it in time/,
  )
})

test('a navigation is asked about the site it goes to', () => {
  let go = {
    id: 'c',
    tool: 'browser_navigate',
    args: { url: 'https://b.com/' },
  }
  equal(asks(go, allowed), null)
  equal(asks(go, { ...allowed, allowed: false }), 'https://b.com')
  match(
    refused(
      'browser_navigate',
      { ...allowed, allowed: false, answered: 'no' },
      go.args,
    ),
    /chose not to let you use b\.com/,
  )
  match(
    refused('browser_navigate', allowed, { url: 'javascript:alert(1)' }),
    /is not a web address/,
  )
})
