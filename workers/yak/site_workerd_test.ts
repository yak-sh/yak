// The public site as workerd serves it at the apex: the generated addresses
// and the guide read back through the assets binding. What the pages say is
// site_test.ts's, read from disk.

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { PAGES, uriOf, WHOLE } from './guide.ts'
import { kernel } from './probe.ts'
import { ADDRESSES } from './seo.ts'

// The generated addresses, in workerd, at the apex and not on a space's
// hostname — where robots.txt is the customer's own file (route.ts) and always
// has been.
Deno.test('the apex answers the crawler and the model', async () => {
  let k = await kernel()
  try {
    let robots = await k.at('yaks.app', '/robots.txt')
    assertEquals(robots.status, 200)
    assertEquals(
      robots.headers.get('content-type'),
      'text/plain; charset=utf-8',
    )
    let text = await robots.text()
    assertStringIncludes(text, 'User-agent: ClaudeBot')
    assertStringIncludes(text, 'Sitemap: https://yaks.app/sitemap.xml')

    // Where to report a security problem (RFC 9116), at the one address a
    // researcher or a scanner looks for it.
    let sec = await k.at('yaks.app', '/.well-known/security.txt')
    assertEquals(sec.status, 200)
    assertEquals(sec.headers.get('content-type'), 'text/plain; charset=utf-8')
    let contact = await sec.text()
    assertStringIncludes(contact, 'Contact: mailto:hello@yaks.app')
    assertStringIncludes(contact, 'Preferred-Languages: en')
    assertStringIncludes(
      contact,
      'Canonical: https://yaks.app/.well-known/security.txt',
    )
    assert(/\nExpires: \d{4}-/.test(contact), contact)

    let map = await k.at('yaks.app', '/sitemap.xml')
    assertEquals(map.status, 200)
    assertStringIncludes(
      map.headers.get('content-type') ?? '',
      'application/xml',
    )
    let xml = await map.text()
    for (let url of ADDRESSES) assertStringIncludes(xml, `<loc>${url}</loc>`)

    // The index, and the whole guide in one fetch — both read the guide's
    // files back through the assets binding, so this proves the addresses are
    // the ones that serve.
    let index = await (await k.at('yaks.app', '/llms.txt')).text()
    assertStringIncludes(index, `- [The guide](${WHOLE}):`)
    for (let p of PAGES) assertStringIncludes(index, uriOf(p.slug))

    let whole = await (await k.at('yaks.app', '/llms-full.txt')).text()
    assertStringIncludes(whole, '# Building a yaks app')
    // And it says the name outright, once, at the top (T-34302, b63b2a32).
    assertStringIncludes(whole, 'The platform is yaks.app')
    for (let p of PAGES) {
      assertStringIncludes(whole, `<!-- ${uriOf(p.slug)} -->`)
    }

    // The documentation, drawn from those same files (docs.ts, T-37752): the
    // map, one subject, the technical page beside them, and the 301s the
    // addresses they moved from answer.
    let map2 = await (await k.at('yaks.app', '/docs')).text()
    assertStringIncludes(
      map2,
      '<h1 id="building-a-yaks-app">Building a yaks app</h1>',
    )
    assertStringIncludes(map2, '<a href="/docs/querying">')
    let one = await (await k.at('yaks.app', '/docs/querying')).text()
    assertStringIncludes(
      one,
      '<title>Querying: the filter grammar · yaks.app</title>',
    )
    // Every page of the documentation reads beside the list of them, and a
    // drawn page also beside its own sections, linked by the ids the renderer
    // put on those headings (T-37774).
    assertStringIncludes(one, '<nav class="Page_Side SideNav Docs_Nav"')
    assertStringIncludes(one, '<nav class="Page_Aside Docs_Contents"')
    let jump = /<a href="#([^"]+)">/.exec(one)![1]
    assertStringIncludes(one, ` id="${jump}">`)
    let tech = await (await k.at('yaks.app', '/docs/technical')).text()
    assertStringIncludes(tech, '<h1 id="technical-details">Technical details')
    assertStringIncludes(tech, '<nav class="Page_Side SideNav Docs_Nav"')
    assertStringIncludes(
      tech,
      '<a href="/docs/technical" aria-current="page">Technical details</a>',
    )

    // And the whole rule, against the server that serves it: `.md` on a
    // page's own address is the file, served by the assets binding, and the
    // page is that same text drawn (T-37793).
    for (let at of ['/docs', '/docs/querying', '/docs/technical']) {
      let file = await k.at('yaks.app', `${at}.md`, { redirect: 'manual' })
      assertEquals(file.status, 200, `${at}.md`)
      assertStringIncludes(
        file.headers.get('content-type') ?? '',
        'markdown',
        `${at}.md`,
      )
      let lead = /^# (.+)$/m.exec(await file.text())![1]
      assertStringIncludes(
        await (await k.at('yaks.app', at)).text(),
        `>${lead}</h1>`,
        at,
      )
    }

    for (
      let [was, now] of [
        ['/technical', '/docs/technical'],
        ['/guide.md', '/docs.md'],
        ['/guide/querying.md', '/docs/querying.md'],
      ]
    ) {
      let moved = await k.at('yaks.app', was, { redirect: 'manual' })
      await moved.body?.cancel()
      assertEquals(moved.status, 301, was)
      assertEquals(moved.headers.get('location'), `https://yaks.app${now}`, was)
    }

    // A space with no app of that name has nothing to serve there, and the
    // apex's file is not borrowed for it.
    let theirs = await k.at('jeff.yaks.app', '/robots.txt')
    assert(!(await theirs.text()).includes('Sitemap: https://yaks.app'))
    // And `/.well-known/` on a space's hostname is the platform's, with
    // nothing of ours to say there (route.ts `platform`).
    let none = await k.at('jeff.yaks.app', '/.well-known/security.txt')
    await none.text()
    assertEquals(none.status, 404)
  } finally {
    await k.stop()
  }
})
