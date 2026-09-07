import { assertEquals, assertStringIncludes } from '@std/assert'
import { instructions, pageFor, uriOf, whole } from './guide.ts'
import { addresses, connector, llms, robots, sitemap } from './seo.ts'

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
  assertEquals(whole(env), 'https://yaks.fyi/guide.md')
  assertEquals(uriOf('mail', env), 'https://yaks.fyi/guide/mail.md')
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
    assertStringIncludes(text, 'https://yaks.fyi/guide.md')
  }
  assertStringIncludes(instructions(env), 'This is yaks.app')
  assertStringIncludes(instructions(env), '<space>.<app>@yaks.fyi')
})
