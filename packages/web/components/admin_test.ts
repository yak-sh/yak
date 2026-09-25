// DOM-mount tests for the <Admin/> index view — these render the real view
// through Preact + linkedom, so they import the heavy Admin.tsx and cannot hit
// the 1ms budget. The PURE census-derivation tests moved to admin_logic_test.ts
// (light imports, sub-ms); keep only the render tests here.
import { until } from '../testing.ts'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { loadVocab } from '@yaks/vocab'
import { Admin } from './Admin.tsx'
import { route } from './nav.tsx'
import { cache, landSub, useRoute } from '../live.ts'
import { assertEquals } from '@std/assert'

// A mounted view holds subscriptions. In a test there is no server to hold
// them against, so control frames go nowhere through live.ts's transport
// seam — the cache here is only ever what the test seeds.
useRoute(() => {})

// The index is a DB renderer: each section fetches `/query?.{kind}!`. Answer
// that fetch from the seeded cache bags, so these tests keep one source of
// truth; everything else falls through to the real fetch.
let stubFetch = () => {
  let real = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL) => {
    let m = String(input).match(/\/query\?\.(\w+)!/)
    if (!m) return real(input)
    let kind = m[1]
    let out = Object.values(cache.peek())
      .filter((bag) => (bag as Record<string, unknown>)[kind])
    return Promise.resolve(Response.json(out))
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}
// Preact runs effects on its ~100ms rAF-fallback clock under linkedom, so a
// fixed tick cannot cover the fetch round-trip — wait on the rendered fact.
let settle = (root: Element, sel = '.Admin_Cell') =>
  until(() => root.querySelector(sel), { label: sel })

Deno.test('the index shows the component description from its vocabulary', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let vocabulary = loadVocab({
    $defs: {
      task: {
        component: true,
        type: 'object',
        description: 'a thing to do',
        properties: {},
      },
    },
  })
  route.value = '/admin/task'
  let root = document.querySelector('main')!
  let restore = stubFetch()
  try {
    render(h(Admin, { vocabulary }), root)
    await settle(root, '.Admin_Description')
    assertEquals(
      root.querySelector('.Admin_Description')?.textContent,
      'a thing to do',
    )
  } finally {
    render(null, root)
    restore()
    cache.value = {}
    route.value = '/'
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
