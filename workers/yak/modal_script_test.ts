import { test, tick } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { DOMParser, parseHTML } from 'linkedom'

let code = await Deno.readTextFile(
  new URL('./public/modal.js', import.meta.url),
)
let details = (name: string) =>
  `<div class="Modal_Body"><h2>${name}</h2><a href="/manage/ada/connections?q=crm#" data-modal-close>Close</a><input value=""></div>`
let fixture = (
  hash = '',
  fetcher = (_url: URL) => Promise.resolve(new Response('')),
) => {
  let { document, window } = parseHTML(
    `<div data-connections><a href="/manage/ada/connections?q=crm#hubspot">HubSpot</a></div>
    <dialog class="Modal"><a class="Modal_Backdrop" data-modal-close href="/manage/ada/connections?q=crm#">Backdrop</a>
    <template data-modal-loading><div class="Modal_Body"><a data-modal-close href="/manage/ada/connections?q=crm#">Close</a><p role="status">Loading…</p></div></template></dialog>
    <template data-modal-key="hubspot">${details('HubSpot')}</template>`,
  )
  let location = new URL(`https://yaks.app/manage/ada/connections?q=crm${hash}`)
  let history: string[] = []
  let requests: URL[] = []
  let errors: unknown[] = []
  let dialog = document.querySelector('dialog')!
  Object.assign(dialog, {
    close: () => dialog.removeAttribute('open'),
    showModal: () => dialog.setAttribute('open', ''),
  })
  new Function(
    'document',
    'globalThis',
    'location',
    'history',
    'fetch',
    'DOMParser',
    'reportError',
    code,
  )(
    document,
    window,
    location,
    {
      pushState: (_state: unknown, _unused: string, url: string) => {
        history.push(url)
        location.href = new URL(url, location).href
      },
    },
    (url: URL) => {
      requests.push(url)
      return fetcher(url)
    },
    DOMParser,
    (e: unknown) => errors.push(e),
  )
  let click = (selector: string) => {
    let event = new window.Event('click', { bubbles: true, cancelable: true })
    document.querySelector(selector)!.dispatchEvent(event)
    assert(event.defaultPrevented)
  }
  let visit = (hash: string) => {
    location.hash = hash
    window.dispatchEvent(new window.Event('hashchange'))
  }
  return {
    document,
    window,
    dialog,
    location,
    history,
    requests,
    errors,
    click,
    visit,
  }
}

test('hash links open and close cached forms immediately without a request, keeping typed values', () => {
  let f = fixture()
  assert(!f.dialog.hasAttribute('open'))
  f.click('[data-connections] a')
  assert(f.dialog.hasAttribute('open'))
  assertEquals(f.location.hash, '#hubspot')
  assert(f.document.querySelector('[data-connections]')!.hasAttribute('inert'))
  let input = f.dialog.querySelector('input')!
  input.value = 'unsent key'
  f.click('.Modal_Body [data-modal-close]')
  assert(!f.dialog.hasAttribute('open'))
  assert(!f.document.querySelector('[data-connections]')!.hasAttribute('inert'))
  f.visit('#hubspot')
  assertEquals(f.dialog.querySelector('input'), input)
  assertEquals(input.value, 'unsent key')
  f.click('.Modal_Backdrop')
  assert(!f.dialog.hasAttribute('open'))
  assertEquals(f.requests, [])
  assertEquals(f.history, [
    '/manage/ada/connections?q=crm#hubspot',
    '/manage/ada/connections?q=crm',
    '/manage/ada/connections?q=crm',
  ])
})

test('a direct hash opens on load; back, forward and Escape open and close it', () => {
  let f = fixture('#hubspot')
  assert(f.dialog.hasAttribute('open'))
  f.visit('')
  assert(!f.dialog.hasAttribute('open'))
  f.visit('#hubspot')
  assert(f.dialog.hasAttribute('open'))
  let event = new f.window.Event('cancel', { cancelable: true })
  f.dialog.dispatchEvent(event)
  assert(event.defaultPrevented)
  assertEquals(f.location.hash, '')
  assert(!f.dialog.hasAttribute('open'))
  f.visit('#find')
  assertEquals(f.requests, [])
})

test('a missing service opens immediately, fetches without navigation, and retains its content', async () => {
  let finish!: (r: Response) => void
  let response = new Promise<Response>((resolve) => finish = resolve)
  let f = fixture('#cal', () => response)
  assert(f.dialog.hasAttribute('open'))
  assertEquals(f.dialog.querySelector('[role=status]')!.textContent, 'Loading…')
  assertEquals(f.requests[0].searchParams.get('detail'), 'cal')
  assertEquals(f.requests[0].hash, '')
  finish(
    new Response(
      `<dialog data-modal-key="cal">${details('Calendar')}</dialog>`,
    ),
  )
  // Await the asynchronous replacement through the document it changes.
  await new Promise<void>((resolve) => {
    let observer = new f.window.MutationObserver(() => {
      if (f.dialog.querySelector('h2')?.textContent != 'Calendar') return
      observer.disconnect()
      resolve()
    })
    observer.observe(f.dialog, { childList: true })
  })
  assertEquals(f.location.hash, '#cal')
  f.visit('')
  f.visit('#cal')
  assertEquals(f.dialog.querySelector('h2')!.textContent, 'Calendar')
  assertEquals(f.requests.length, 1)
  assertEquals(f.errors, [])
})

test('a fetched service cannot reopen or replace a dialog after the person moves on', async () => {
  let finish!: (r: Response) => void
  let response = new Promise<Response>((resolve) => finish = resolve)
  let f = fixture('#cal', () => response)
  f.visit('#hubspot')
  finish(
    new Response(
      `<dialog data-modal-key="cal">${details('Calendar')}</dialog>`,
    ),
  )
  await response
  await tick()
  assertEquals(f.dialog.querySelector('h2')!.textContent, 'HubSpot')
  f.visit('')
  assert(!f.dialog.hasAttribute('open'))
})

test('closing a cached modal preserves the query after an in-page search changed it', () => {
  let f = fixture()
  f.location.search = '?q=calendar'
  f.visit('#hubspot')
  f.click('.Modal_Body [data-modal-close]')
  assertEquals(f.location.search, '?q=calendar')
  assertEquals(f.location.hash, '')
  assert(!f.dialog.hasAttribute('open'))
  assertEquals(f.requests, [])
})
