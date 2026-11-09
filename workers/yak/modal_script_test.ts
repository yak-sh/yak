import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'

let code = await Deno.readTextFile(
  new URL('./public/modal.js', import.meta.url),
)

test('a server-open dialog becomes modal and Escape follows its close URL', () => {
  let { document, window } = parseHTML(
    '<dialog class="Modal" open><a data-modal-close href="/manage/ada/connections?q=crm">Close</a></dialog>',
  )
  let dialog = document.querySelector('dialog')!
  let modal = false
  Object.assign(dialog, {
    close: () => dialog.removeAttribute('open'),
    showModal: () => {
      assertEquals(dialog.hasAttribute('open'), false)
      dialog.setAttribute('open', '')
      modal = true
    },
  })
  let went = ''
  new Function('document', 'location', code)(document, {
    assign: (url: string) => went = url,
  })
  assert(modal)
  let cancel = new window.Event('cancel', { cancelable: true })
  dialog.dispatchEvent(cancel)
  assert(cancel.defaultPrevented)
  assertEquals(went, '/manage/ada/connections?q=crm')
})
