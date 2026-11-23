import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { uiMeta } from './app-view.ts'

// Portable hosts choose their sandbox. ChatGPT may use its namespaced origin.
test('view metadata leaves portable sandbox selection to the host', () => {
  let bare = uiMeta('https://yaks.app')
  assertEquals(bare['openai/widgetDomain'], 'https://yaks.app')
  // A strict Claude host rejects a website origin in ui.domain; omission is
  // allowed. Unknown hosts must not receive a guessed Claude or OpenAI domain.
  const acceptsClaude = (meta: { ui: { domain?: string; csp?: unknown } }) =>
    meta.ui.domain == null ||
    /^[a-f0-9]{32}\.claudemcpcontent\.com$/.test(meta.ui.domain)
  assertEquals(acceptsClaude({ ui: { domain: 'https://yaks.app' } }), false)
  assertEquals(acceptsClaude(bare), true)
  assertEquals(Object.hasOwn(bare.ui, 'domain'), false)

  // An empty allowlist is a declaration — this page fetches nothing — and is
  // what the platform's own two inline views say. Saying nothing at all is
  // what a host reads as no policy, and stamps "CSP off" on.
  assertEquals(bare.ui.csp, {})
  assertEquals(bare['openai/widgetCSP'], {
    connect_domains: [],
    resource_domains: [],
  })
  // An app's own view reaches back to its own site for the stylesheet beside
  // it, and names that site again for its `<base href>` to be honored.
  let site = 'https://jeff.yaks.app'
  let its = uiMeta(site, { resourceDomains: [site], baseUriDomains: [site] })
  assertEquals(its.ui.csp.resourceDomains, [site])
  assertEquals(its.ui.csp.baseUriDomains, [site])
  assertEquals(its['openai/widgetCSP'].resource_domains, [site])
  // `base-uri` has no older name; the standard surface carries it alone.
  assertEquals(its['openai/widgetCSP'].connect_domains, [])
})
