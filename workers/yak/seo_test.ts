import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { instructions, pageFor, uriOf, whole } from './guide.ts'
import { addresses, connector, llms, robots, security, sitemap } from './seo.ts'

Deno.test('seo: staging metadata and guide addresses stay on its own host', () => {
  let env = { APEX: 'yaks.fyi' }
  let info = connector(env)
  assertEquals([info.name, info.title, info.websiteUrl], [
    'yaks.app',
    'yaks.app',
    'https://yaks.fyi',
  ])
  assertEquals(
    info.icons.every((icon) => icon.src.startsWith('https://yaks.fyi/')),
    true,
  )
  assertEquals(
    addresses(env).every((url) => url.startsWith('https://yaks.fyi/')),
    true,
  )
  assertEquals(whole(env), 'https://yaks.fyi/docs.md')
  assertEquals(uriOf('mail', env), 'https://yaks.fyi/docs/mail.md')
  assertEquals(pageFor('mail', env), uriOf('mail', env))
  assertEquals(pageFor('unknown', env), undefined)
  for (
    let text of [
      robots(env),
      sitemap(null, env),
      llms([], env),
      instructions(env),
    ]
  ) {
    assertEquals(text.includes('https://yaks.app'), false)
    assertStringIncludes(text, 'https://yaks.fyi/docs.md')
  }
  assertStringIncludes(instructions(env), 'This is yaks.app')
  assertStringIncludes(instructions(env), '<space>.<app>@yaks.fyi')
})

// RFC 9116, and the two fields it requires: an address to write to and a date
// the file stops speaking for itself. Both belong to the deployment serving
// it, and the date is computed at the moment it is asked for, so it is never
// the stale year somebody typed in once.
Deno.test('security.txt names an address, an expiry and its own canonical', () => {
  let now = new Date('2026-09-22T11:30:00Z')
  assertEquals(security(now, { APEX: 'yaks.fyi' }).split('\n'), [
    'Contact: mailto:hello@yaks.fyi',
    'Expires: 2027-09-22T00:00:00.000Z',
    'Preferred-Languages: en',
    'Canonical: https://yaks.fyi/.well-known/security.txt',
    '',
  ])
  // Ahead of the ask, and under a year ahead of it, which is what keeps the
  // file believed.
  let expires = Date.parse(/^Expires: (.+)$/m.exec(security(now))![1])
  assert(expires > now.getTime(), 'the expiry is in the past')
  assert(expires - now.getTime() < 365 * 24 * 60 * 60 * 1000, 'a year or more')
  assertStringIncludes(security(now), 'Contact: mailto:hello@yaks.app')
})
