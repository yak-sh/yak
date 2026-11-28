// A page's React answers every name each of React's modules does, so a page
// script importing one never fails to link in the browser.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import * as shared from './page-react.ts'

// Deno's CommonJS interop says the module object itself as a name too.
let names = (m: object) =>
  Object.keys(m).filter((n) => n != 'default' && n != 'module.exports')

for (
  let specifier of [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
  ]
) {
  test(`the page's React answers every name of ${specifier}`, async () => {
    let missing = names(await import(specifier)).filter((n) => !(n in shared))
    assertEquals(missing, [])
  })
}
