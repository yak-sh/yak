import { equal, match, test } from '@yaks/testing'
import { answering, asks, type Seen } from './answer.ts'

let URL = 'https://example.com/post'
let page = { url: URL, title: 'Post', text: 'Hello ``` world', selection: '' }
let allowed: Seen = { url: URL, title: 'Post', allowed: true }
let said = (tool: string, seen: Seen) =>
  answering({ id: 'c1', tool, args: {} }, seen).answer

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

let refused = (tool: string, seen: Seen) => said(tool, seen).error ?? ''

test('a call that cannot be answered says why', () => {
  match(refused('browser_click', allowed), /no tool called browser_click/)
  match(
    refused('browser_text', { url: 'chrome://newtab/', allowed: true }),
    /not a web page/,
  )
  match(
    refused('browser_text', { url: URL, allowed: false }),
    /has not allowed you to read example\.com yet\. The extension is asking them/,
  )
  match(
    refused('browser_text', { ...allowed, failed: 'frame gone' }),
    /could not read .*: frame gone/,
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
    asks(call('browser_text'), { url: 'chrome://newtab/', allowed: false }),
    null,
  )
})
