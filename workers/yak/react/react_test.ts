// A page's shared React answers every name React's own modules do, so a
// page script importing one never fails to link in the browser.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'

let SHARED = {
  'react': () => import('./react.ts'),
  'react/jsx-runtime': () => import('./jsx-runtime.ts'),
  'react-dom': () => import('./react-dom.ts'),
  'react-dom/client': () => import('./react-dom-client.ts'),
}
// Deno's CommonJS interop says the module object itself as a name too.
let names = (m: object) =>
  Object.keys(m).filter((n) => n != 'default' && n != 'module.exports').sort()

for (let [specifier, shared] of Object.entries(SHARED)) {
  test(`the page's ${specifier} answers every name of React's`, async () => {
    let answered = new Set(names(await shared()))
    let missing = names(await import(specifier)).filter((n) => !answered.has(n))
    assertEquals(missing, [])
  })
}
