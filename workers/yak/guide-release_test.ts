// Execute the browser example from the release guide with an isolated page:
// taking over the notice must not throw away the person's unfinished work.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { fences } from '../../packages/testing/examples.ts'

let page = Deno.readTextFileSync(
  new URL('./public/docs/files.md', import.meta.url),
)
let example = fences(page).find((f) => f.lang == 'js')!

test('release guide example takes over notices and waits for a Reload click', () => {
  let window = new EventTarget()
  let reloads = 0
  let input = { value: 'three lemons, not yet saved' }
  let elements = new Map(
    ['notice', 'message', 'reload', 'dismiss'].map((name) => [
      `#release-${name}`,
      { hidden: true, textContent: '', onclick: () => {} },
    ]),
  )
  let document = { querySelector: (id: string) => elements.get(id) }
  Object.assign(window, { location: { reload: () => reloads++ } })
  new Function('window', 'document', example.code)(window, document)

  let release = (version: number, reload: string) => {
    let event = new CustomEvent('yak-release', {
      cancelable: true,
      detail: { version, reload, future: 'additional fields are allowed' },
    })
    assertEquals(window.dispatchEvent(event), false)
    assertEquals(event.defaultPrevented, true)
    assertEquals(input.value, 'three lemons, not yet saved')
    return elements.get('#release-notice')!
  }
  let dismiss = elements.get('#release-dismiss')!
  let message = elements.get('#release-message')!
  let notice = release(2, 'optional')
  assertEquals(notice.hidden, false)
  assertEquals(message.textContent, 'A new version of this app is out')
  assertEquals(dismiss.hidden, false)
  dismiss.onclick()
  assertEquals(notice.hidden, true)
  assertEquals(reloads, 0)

  release(3, 'required')
  assertEquals(notice.hidden, false)
  assertEquals(dismiss.hidden, true)
  assertEquals(
    message.textContent,
    'This app has changed. Copy unfinished work, then reload to keep using it',
  )
  assertEquals(reloads, 0)
  elements.get('#release-reload')!.onclick()
  assertEquals(reloads, 1)
  assertEquals(input.value, 'three lemons, not yet saved')
})
