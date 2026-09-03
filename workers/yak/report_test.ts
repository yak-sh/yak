// A page's own breaks, held in workerd (probe.ts boots the kernel): the
// kernel injects the reporter into every page it serves, says where the
// browser should send what it notices, and takes both shapes of report at
// `POST /api/report` — which puts an `exception` in the app's store, where
// the agent's next reply reads it (D-32318 §Errors are surfaced).
//
// The browser is the part a probe cannot boot, so the test posts what a
// browser would post; that the page carries the reporter at all is asserted
// on the served bytes.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, meta, seed } from './probe.ts'

slow('a page reports its own breaks, and the agent hears', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let files = client(k, 'jeff.yaks.app', 'recipes', cookie)
    let agent = connector(k, cookie)
    let app = { space: 'jeff', app: 'recipes' }
    let report = (body: unknown, type = 'application/json') =>
      k.at('jeff.yaks.app', '/recipes/api/report', {
        method: 'POST',
        headers: { 'content-type': type },
        body: JSON.stringify(body),
      })

    // Every page the kernel serves carries the reporter, wherever it fits,
    // and every response says where the browser should send what it notices.
    await files.put(
      '/index.html',
      '<!doctype html><html><head><title>R</title>' +
        '</head><body><script>boom()</script></body></html>',
    )
    let page = await k.at('jeff.yaks.app', '/recipes/')
    let html = await page.text()
    assertEquals(
      html.split('/recipes/api/report.js').length - 1,
      1,
      'injected once',
    )
    assertMatch(html, /<head><script src="\/recipes\/api\/report\.js">/)
    assertMatch(
      page.headers.get('reporting-endpoints') ?? '',
      /yak="http.*\/recipes\/api\/report"/,
    )
    assertMatch(page.headers.get('nel') ?? '', /"report_to":"yak"/)
    assertMatch(
      (await k.at('jeff.yaks.app', '/recipes/api/report.js')).headers
        .get('content-type') ?? '',
      /javascript/,
    )

    // A page with no head and no body still gets it.
    await files.put('/bare.html', '<!doctype html><h1>bare</h1>')
    assertMatch(
      await (await k.at('jeff.yaks.app', '/recipes/bare.html')).text(),
      /<h1>bare<\/h1>[\s\S]*report\.js/,
    )

    // What the injected script posts, and what the browser posts on its own.
    assertEquals(
      (await report({
        message: 'boom is not a function',
        stack: 'at /recipes/:1',
        url: 'https://jeff.yaks.app/recipes/',
        line: 1,
      })).status,
      204,
    )
    assertEquals(
      (await report([{
        type: 'csp-violation',
        url: 'https://jeff.yaks.app/recipes/',
        body: {
          effectiveDirective: 'script-src',
          blockedURL: 'https://evil.example/x.js',
          documentURL: 'https://jeff.yaks.app/recipes/',
        },
      }], 'application/reports+json')).status,
      204,
    )
    // Junk is the sender's bug, not a break in the app: nothing is written.
    assertEquals((await report('not a report')).status, 204)

    // Both reach the agent, once, on its next reply.
    let told = await agent.tool('graph_query', { ...app, query: '.doc!' })
    assertMatch(told, /exception recipes: page \/recipes\/ — boom is not a/)
    assertMatch(
      told,
      /exception recipes: csp-violation \/recipes\/ — script-src https:\/\/evil/,
    )
    assertEquals(
      told.split(' exception recipes: ').length - 1,
      2,
      'two, and only two',
    )
    assert(
      !(await agent.tool('graph_query', { ...app, query: '.doc!' })).includes(
        'unseen',
      ),
      'served once',
    )

    // A page in a loop cannot flood the door.
    let statuses = []
    for (let n = 0; n < 34; n++) {
      statuses.push((await report({ message: `loop ${n}` })).status)
    }
    assert(statuses.includes(429), 'the door said stop')
    let listed = await agent.tool('app_errors', app)
    assert(
      listed.split('\n').filter((l) => l.startsWith('- ')).length <= 34,
      'the flood was capped',
    )
  } finally {
    await k.stop()
  }
})

// A refusal the door answered on purpose is the platform working, so it files
// nothing; a page that threw still lands (C-32652 item 3, T-32655).
slow('a refusal the door meant is not a break', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'club', apps: ['runs'] }])
    let agent = connector(k, cookie)
    let app = { space: 'club', app: 'runs' }
    let report = (body: unknown) =>
      k.at('club.yaks.app', '/runs/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    // A signed-out visitor clicks the app's own button: the door says no on
    // purpose, and the guide's flow follows `signIn` to the sign-in page.
    let no = await k.at('club.yaks.app', '/runs/api/apply', {
      method: 'POST',
      body: JSON.stringify([]),
    })
    assertEquals(no.status, 401)
    let said = await no.text()
    assertEquals(JSON.parse(said).error.code, 'not_a_writer')

    // What the reporter posts about that — and what it posts about a page
    // that threw, which is a break at the same door.
    assertEquals(
      (await report({
        message: `401 /runs/api/apply: ${said}`,
        url: 'https://club.yaks.app/runs/',
        status: 401,
        answer: said,
      })).status,
      204,
    )
    assertEquals(
      (await report({
        message: 'boom is not a function',
        stack: 'at /runs/:1',
        url: 'https://club.yaks.app/runs/',
      })).status,
      204,
    )

    // And the same rule for a no the APP answered (C-32869 item 5, T-32874):
    // the app's worker asked an outside service with a key its owner
    // mistyped, was told 401, and answered the page a sentence in its own
    // words. That is the app working; an outside service does not spell its
    // no the way our doors spell theirs, so the rule reads the STATUS.
    assertEquals(
      (await report({
        message: '401 /runs/weather: the weather service refused our key',
        url: 'https://club.yaks.app/runs/',
        status: 401,
        answer: 'the weather service refused our key',
      })).status,
      204,
    )
    // A 5xx the app answered is nobody's choice, and still lands.
    assertEquals(
      (await report({
        message: '500 /runs/weather: undefined is not an object',
        url: 'https://club.yaks.app/runs/',
        status: 500,
        answer: 'undefined is not an object',
      })).status,
      204,
    )

    let told = await agent.tool('app_errors', app)
    assert(!told.includes('not_a_writer'), 'the refusal filed nothing')
    assert(!told.includes('refused our key'), "the app's own no filed nothing")
    assertMatch(told, /boom is not a function/)
    assertMatch(told, /undefined is not an object/)
    assertEquals(
      told.split('\n').filter((l) => l.startsWith('- ')).length,
      2,
      'two lines, and both are breaks',
    )
  } finally {
    await k.stop()
  }
})

// A break names the deploy it happened ON. The directory's read cache is 30
// seconds wide and private to an isolate, so a version bump made anywhere
// else is invisible to an ordinary read — which is how the ninth user test's
// first throw after a deploy filed as `weather v1` while the deploy had just
// answered v2 (C-32869 item 4). The report path reads past the cache.
slow('a break names the version the app is serving', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let agent = connector(k, cookie)

    // Serving the app puts its row in the read cache.
    await (await k.at('jeff.yaks.app', '/recipes/')).body?.cancel()
    // A bump through the graph tier, which is NOT the door that empties that
    // cache — so the kernel is now holding a version the app has moved past,
    // exactly as it is in the seconds after somebody else's deploy.
    await meta(k, cookie).apply([
      { entity: { eid: eids['jeff/recipes'] }, app: { version: 9 } },
    ])

    await (await k.at('jeff.yaks.app', '/recipes/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'boom is not a function',
        url: 'https://jeff.yaks.app/recipes/',
      }),
    })).body?.cancel()

    assertMatch(
      await agent.tool('app_errors', { space: 'jeff', app: 'recipes' }),
      /recipes v9: page \/recipes\/ — boom is not a function/,
    )
  } finally {
    await k.stop()
  }
})

// A page that dies on its first import (T-32909, C-32905 items 2 and 8): the
// module 404'd, the app store held no open error, and the person was left
// looking at a heading and empty space. The browser is the part a probe
// cannot boot, so this holds the two halves where they live — the door files
// the break the reporter posts for a file that never loaded, and the reporter
// every page is served carries the soft state, and the capture-phase listener
// that catches such a break at all.
slow('a page that dies on its first import says so', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'jeff', apps: ['weather'] }])
    let files = client(k, 'jeff.yaks.app', 'weather', cookie)
    let agent = connector(k, cookie)
    let app = { space: 'jeff', app: 'weather' }

    // The installed copy's own shape: a shell, and a module beside it that is
    // not there.
    await files.put(
      '/index.html',
      '<!doctype html><html><head><title>W</title></head><body>' +
        '<h1>Weather</h1><script type="module" src="app.js"></script>' +
        '</body></html>',
    )
    let page = await k.at('jeff.yaks.app', '/weather/')
    assertMatch(await page.text(), /<script src="\/weather\/api\/report\.js">/)
    assertEquals((await k.at('jeff.yaks.app', '/weather/app.js')).status, 404)

    // What the reporter posts for that, and the one break it becomes.
    assertEquals(
      (await k.at('jeff.yaks.app', '/weather/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'failed to load script https://jeff.yaks.app/weather/app.js',
          url: 'https://jeff.yaks.app/weather/app.js',
        }),
      })).status,
      204,
    )
    let told = await agent.tool('app_errors', app)
    assertEquals(
      told.split('\n').filter((l) => l.startsWith('- ')).length,
      1,
      'one break, not none',
    )
    assertMatch(told, /page \/weather\/app\.js — failed to load script/)
    assertStringIncludes(told, 'https://jeff.yaks.app/weather/app.js')

    // And the soft state the page shows instead of empty space, carried by
    // the reporter the page is served.
    let reporter = await (await k.at('jeff.yaks.app', '/weather/api/report.js'))
      .text()
    assertStringIncludes(
      reporter,
      'Something went wrong. Your assistant has been told.',
    )
    assertMatch(reporter, /addEventListener\('error'[\s\S]*\}, true\)/)
  } finally {
    await k.stop()
  }
})
