import { assertEquals, assertStringIncludes } from '@std/assert'
import { sealed } from './cache.ts'
import { records } from './domains.ts'
import { apex, hosted, spaceHost, url } from './host.ts'
import { mailedTo, mailFrom, replyTo } from './post.ts'
import { aimedAt, foreign, onZone, platform, route, says } from './route.ts'

let env = { APEX: 'yaks.fyi' }

Deno.test('platform text changes address hosts while retaining the product and other domains', () => {
  for (
    let [before, after] of [
      ['yaks.app builds apps.', 'yaks.app builds apps.'],
      ['plugins/yaks.app is a product', 'plugins/yaks.app is a product'],
      ['https://yaks.app/guide.md', 'https://yaks.fyi/guide.md'],
      ['https://yaks.app:8443/guide.md', 'https://yaks.fyi:8443/guide.md'],
      ['Read https://yaks.app.', 'Read https://yaks.fyi.'],
      [
        'https://yaks.app:secret@evil/ ada.yaks.app',
        'https://yaks.app:secret@evil/ ada.yaks.fyi',
      ],
      [
        'https://evil/path/ada.yaks.app?q=hi@yaks.app',
        'https://evil/path/ada.yaks.app?q=hi@yaks.app',
      ],
      [
        'http://ada.yaks.app/recipes/?x=1#end',
        'http://ada.yaks.fyi/recipes/?x=1#end',
      ],
      [
        'yourname.yaks.app, <space>.yaks.app.',
        'yourname.yaks.fyi, <space>.yaks.fyi.',
      ],
      [
        '<strong>yourname</strong>.yaks.app',
        '<strong>yourname</strong>.yaks.fyi',
      ],
      ['mailto:hello@yaks.app', 'mailto:hello@yaks.fyi'],
      ['<space>.<app>@yaks.app', '<space>.<app>@yaks.fyi'],
      [
        'https://yaks.app.evil/ https://ada.yaks.app.evil/',
        'https://yaks.app.evil/ https://ada.yaks.app.evil/',
      ],
      [
        'hello@yaks.app.evil yaks.application ada.yaks.app-other',
        'hello@yaks.app.evil yaks.application ada.yaks.app-other',
      ],
      [
        'https://yaks.app@evil/ https://yaks.appé/',
        'https://yaks.app@evil/ https://yaks.appé/',
      ],
      [
        '<iframe src="https://yourname.yaks.app/recipes/"></iframe><a href="https://yaks.app/login">yaks.app</a>',
        '<iframe src="https://yourname.yaks.fyi/recipes/"></iframe><a href="https://yaks.fyi/login">yaks.app</a>',
      ],
      [
        '{"name":"yaks.app","url":"https://yaks.app/","email":"hello@yaks.app"}',
        '{"name":"yaks.app","url":"https://yaks.fyi/","email":"hello@yaks.fyi"}',
      ],
    ]
  ) {
    assertEquals(hosted(before, env), after)
    assertEquals(hosted(before, {}), before)
  }
})

Deno.test('addresses follow the deployment while production remains the default', () => {
  assertEquals(apex(), 'yaks.app')
  assertEquals(spaceHost(env, 'ada'), 'ada.yaks.fyi')
  assertEquals(url(env, '/login'), 'https://yaks.fyi/login')
  assertStringIncludes(says(env), 'https://yaks.fyi/login')
  assertEquals(records('recipes.example', env)[0].value, 'origin.saas.yaks.fyi')
})

Deno.test('staging owns only its zone and returns only to that zone', () => {
  assertEquals(route('ada.yaks.fyi', '/recipes/menu', env), {
    space: 'ada',
    app: 'recipes',
    path: '/menu',
  })
  assertEquals(route('ada.yaks.app', '/', env).space, null)
  assertEquals(foreign('ada.yaks.fyi', env), false)
  assertEquals(foreign('ada.yaks.app', env), true)
  assertEquals(foreign('ada.yaks.fyi.evil.example', env), true)
  assertEquals(platform('ada.yaks.fyi', '/.well-known/token', env), true)
  assertEquals(
    onZone('https://ada.yaks.fyi/_yaks', env),
    'https://ada.yaks.fyi/_yaks',
  )
  for (
    let href of ['https://ada.yaks.app/', '//evil.example/', '/\\evil.example/']
  ) {
    assertEquals(onZone(href, env), null)
  }
  assertEquals(aimedAt('ada', 'recipes', '/menu', env), {
    host: 'ada.yaks.fyi',
    pathname: '/recipes/menu',
    mount: '/',
  })
})

Deno.test('staging mail addresses round trip only within staging', () => {
  for (let app of ['recipes', null]) {
    let address = mailFrom('ada', app, env)
    assertStringIncludes(address, '@yaks.fyi')
    assertEquals(mailedTo(address, env), { space: 'ada', app })
    assertEquals(mailedTo(address), null)
  }
  assertEquals(replyTo(env), 'hello@yaks.fyi')
  assertEquals(mailedTo('ada@yaks.app', env), null)
})

Deno.test('staging pages allow their own platform to frame them', () => {
  let res = sealed(new Response('page'), env)
  assertEquals(
    res.headers.get('content-security-policy'),
    "frame-ancestors 'self' https://yaks.fyi",
  )
})
