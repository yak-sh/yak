// The half of the pre-auth surface with nothing to look up, held to the two
// things that make it safe to serve to nobody (preauth.ts): it answers out of
// the static site alone, and what it answers is a subset of what a signed-in
// caller already sees. Both are checked here rather than over HTTP because
// both are properties of the module — `answer` is handed a `Site` one binding
// wide, so a test can watch every fetch it makes and know there is nothing
// else it could have made. mcp_test.ts holds the rest: the tools a stranger
// may call, which do read data (anon.ts), and the 401 and its challenge for
// everything neither surface answers.
import { assert, assertEquals } from '@std/assert'
import { PAGES, uriOf, WHOLE } from './guide.ts'
import { answer, DOCS, NO_ARGS, PUBLIC } from './preauth.ts'
import { IDEAS } from './prompts.ts'
import { TOOLS } from './tools.ts'

// The whole world a public answer may touch, and a note of what it touched.
// A handler wanting a store, the directory, blobs or a stream would have to
// invent one: there is no binding here to reach it through.
let site = () => {
  let asked: string[] = []
  return {
    asked,
    ASSETS: {
      fetch: (req: Request) => {
        asked.push(req.url)
        return Promise.resolve(new Response(`# ${new URL(req.url).pathname}`))
      },
    },
  }
}

Deno.test('every public method answers, out of the site and nothing else', async () => {
  let s = site()
  let init = await answer('initialize', { protocolVersion: '2025-03-26' }, s)
  assertEquals(
    (init as { protocolVersion: string }).protocolVersion,
    '2025-03-26',
  )
  assertEquals(await answer('ping', {}, s), {})
  assertEquals(
    (await answer('resources/list', {}, s) as { resources: { uri: string }[] })
      .resources.map((r) => r.uri),
    DOCS.map((d) => d.uri),
  )
  // The one prompt a stranger may pick, and the message it hands back: the
  // ideas, and where the account is for the moment one of them is wanted
  // (T-34557). It names nobody's apps, because nobody is asking.
  assertEquals(
    (await answer('prompts/list', {}, s) as { prompts: { name: string }[] })
      .prompts.map((p) => p.name),
    [IDEAS.name],
  )
  let ideas = await answer('prompts/get', { name: IDEAS.name }, s) as {
    messages: { role: string; content: { text: string } }[]
  }
  assertEquals(ideas.messages[0].role, 'user')
  assert(ideas.messages[0].content.text.includes('https://yaks.app/login'))
  // Nothing so far read anything at all; the one read that follows is the
  // page the caller named, from the address the listing already gave them.
  assertEquals(s.asked, [])
  let read = await answer('resources/read', { uri: uriOf('querying') }, s) as {
    contents: { text: string }[]
  }
  assertEquals(s.asked, [uriOf('querying')])
  assertEquals(read.contents[0].text, '# /guide/querying.md')
})

Deno.test('a protected method, tool or page is not answered here', async () => {
  let s = site()
  for (
    let [method, params] of [
      // No tool at all is this module's (T-34467). Even `about`, whose whole
      // answer is written here, is served through the anonymous door — the
      // one place a tool a stranger may call is listed and run, so the list
      // and the call cannot disagree. A tool of the platform's, a tool of an
      // app's, and a tool nobody wrote read the same either way.
      ['tools/list', {}],
      ['tools/call', { name: 'about' }],
      ['tools/call', { name: 'graph_query' }],
      ['tools/call', { name: 'app_list' }],
      ['tools/call', { name: 'runs__leaderboard' }],
      ['tools/call', {}],
      // Every prompt but the ideas one asks for something to be built or
      // shared, so it stays a person's own — and logging is a break in
      // somebody's app.
      ['prompts/get', { name: 'make' }],
      ['prompts/get', {}],
      ['logging/setLevel', { level: 'error' }],
      // The platform's own views, an app's own view, a guide page nobody
      // wrote — and an asset that is not the guide, which is what says the
      // read is a named list and not a way to fetch the site.
      ['resources/read', { uri: 'ui://yaks/apps' }],
      ['resources/read', { uri: 'ui://yaks/errors' }],
      ['resources/read', { uri: 'ui://mine/runs/leaderboard.html' }],
      ['resources/read', { uri: 'https://yaks.app/guide/nope.md' }],
      ['resources/read', { uri: 'https://yaks.app/index.html' }],
      ['resources/read', {}],
      ['notifications/initialized', {}],
      ['nonsense/method', {}],
    ] as [string, Record<string, unknown>][]
  ) {
    assertEquals(await answer(method, params, s), null, `${method} answered`)
  }
  // And none of them so much as looked at a file.
  assertEquals(s.asked, [])
})

Deno.test('the public tools are the signed-in ones, word for word', async () => {
  for (let t of PUBLIC) {
    let full = TOOLS.find((f) => f.name == t.name)
    assert(full, `${t.name} is public but not offered signed in`)
    assertEquals(full.description, t.description)
    assertEquals(full.input, NO_ARGS)
    // The same words either way: a tool that reads nothing cannot have a
    // second answer for a member.
    assertEquals((await full.run({} as never, {})).text, t.text)
  }
  assert(TOOLS.length > PUBLIC.length, 'signing in has to be worth something')
})

Deno.test('the public resources are the guide, and only the guide', () => {
  assertEquals(DOCS.map((d) => d.uri), [
    WHOLE,
    ...PAGES.map((p) => uriOf(p.slug)),
  ])
  for (let d of DOCS) {
    // Its bytes come off the same address the listing names, which is the
    // address the web already answers to anybody — so this door hands over
    // nothing the internet does not.
    assertEquals(d.page, d.uri)
    assert(d.uri.startsWith('https://yaks.app/'), d.uri)
    assertEquals(d.mimeType, 'text/markdown')
  }
})

// yaks.app is declared to the plugin directories as an app that does not link
// to subscriptions or purchases, and this text is the part of it a stranger
// reads first. Not even "free to start", which names a paid tier by implying
// one.
Deno.test('nothing public sells anything', () => {
  // `subscribe` is deliberately not in this net: it is the client function a
  // page calls to redraw itself (guide/store.md), and the word to catch is
  // the noun, not the verb.
  let sold =
    /subscription|upgrade|pricing|\bplans?\b|billing|per month|free to|\$\d/i
  for (let t of PUBLIC) {
    assertEquals(sold.test(`${t.description} ${t.text}`), false, t.name)
  }
  for (let d of DOCS) {
    assertEquals(sold.test(`${d.title} ${d.description}`), false, d.uri)
  }
})
