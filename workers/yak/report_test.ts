// A page's own breaks, held in workerd (probe.ts boots the kernel): the
// kernel injects the reporter into every page it serves, says where the
// browser should send what it notices, and takes both shapes of report at
// `POST /api/report` — which puts an `exception` in the app's store, where
// the agent's next reply reads it (D-32318 §Errors are surfaced).
//
// The browser is the part a probe cannot boot, so the test posts what a
// browser would post; that the page carries the reporter at all is asserted
// on the served bytes.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, seed } from './probe.ts'

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
