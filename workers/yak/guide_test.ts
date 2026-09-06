// The guide is the map an agent building an app reads (mcp.ts serves it as a
// resource, with a page per subject beside it), so a list printed there has to
// be true.
// What can rot is anything the guide PRINTS that the code also decides: the
// reserved words a manifest is refused against (the code's list, never the
// page's — C-32624 item 1), the components an app has, whose COLUMNS and
// types are what a refusal now spells and what the seventh user test had to
// guess five times over (C-32675 items 2 and 3), and the doors and limits an
// app's own worker.js runs under (T-32780).
import { assert, assertEquals } from '@std/assert'
import { RESERVED } from '../../src/store/vocab.ts'
import { comps, typeName } from '../../src/types.ts'
import { SHIM, upload } from './dispatch.ts'
import type { Env } from './env.ts'
import { PAGES, uriOf } from './guide.ts'
import { ORIGIN } from './route.ts'
import { TOOLS } from './tools.ts'

let guide = Deno.readTextFileSync(
  new URL('./public/guide.md', import.meta.url),
)

let pageText = (slug: string) =>
  Deno.readTextFileSync(new URL(`./public/guide/${slug}.md`, import.meta.url))

// The map still names every page (T-32982). A page nobody is pointed at is a
// page nobody reads: the guide is what a person and an agent read first, so
// the `Deeper:` lines and the resource list have to be the same set — a page
// added to guide.ts and never linked, or a link to a page that was renamed,
// is the whole failure mode of splitting a document.
Deno.test("the guide's Deeper links are exactly the pages offered", () => {
  let linked = [...guide.matchAll(/<https:\/\/yaks\.app\/guide\/(\w+)\.md>/g)]
    .map((m) => m[1])
  let slugs = PAGES.map((p) => p.slug)
  assertEquals(new Set(slugs).size, slugs.length, 'two pages share a slug')
  assertEquals(
    [...new Set(linked)].sort(),
    slugs.sort(),
  )
})

Deno.test('every page offered is a file, and says what it is', () => {
  for (let p of PAGES) {
    let text = pageText(p.slug)
    assert(text.startsWith('# '), `${p.slug} opens with no title`)
    // And it points back, so nobody is stranded on one page of a guide.
    assert(text.includes('yaks.app/guide.md'), `${p.slug} points nowhere back`)
  }
})

// The two rules that cost a user test each hold on every page, not just the
// map: an import that names the app 404s in somebody's installed copy
// (C-32905 item 1), and a worker route under /api/ is the kernel's and can
// never run (C-32869 item 2).
Deno.test('a page teaches the same client import the guide does', () => {
  for (let p of PAGES) {
    assertEquals(
      [...pageText(p.slug).matchAll(/from '([^']*client\.js)'/g)]
        .map((m) => m[1])
        .filter((from) => from != './api/client.js'),
      [],
      p.slug,
    )
  }
})

Deno.test('no worker route on a page is under /api/', () => {
  for (let p of PAGES) {
    let routes = [...pageText(p.slug).matchAll(/pathname[^\n]*?'(\/[^']*)'/g)]
      .map((m) => m[1])
    assertEquals(routes.filter((r) => r.split('/').includes('api')), [], p.slug)
  }
})

// A page may print the reserved words too — it is the page an app's author
// meets them on. Wherever it does, it is the CODE's list, the same rule the
// map is held to (C-32624 item 1).
Deno.test('a page printing the reserved words prints the code list', () => {
  for (let p of PAGES) {
    let block = pageText(p.slug).split('\n\n')
      .find((b) => b.startsWith('    ') && b.includes('stop_request'))
    if (block) assertEquals(block.trim().split(/\s+/), RESERVED, p.slug)
  }
})

// A link from one page to another has to name a page there is.
Deno.test('no page links a page that is not there', () => {
  let slugs = new Set(PAGES.map((p) => p.slug))
  for (let p of PAGES) {
    for (
      let m of pageText(p.slug).matchAll(
        /https:\/\/yaks\.app\/guide\/([\w.-]+)\.md/g,
      )
    ) {
      assert(slugs.has(m[1]), `${p.slug} links ${m[1]}, which is no page`)
    }
    assertEquals(uriOf(p.slug), `https://yaks.app/guide/${p.slug}.md`)
  }
})

// The client is imported RELATIVELY, wherever the guide shows an import, and
// no app's own files name the app: the copy someone installs lives at
// whatever address they took it at, so `/chores/api/client.js` written into a
// page 404s there and the page renders as bare HTML (C-32905 item 1). The
// kernel gives every page a `<base href>` at the app's own address (apps.ts
// `based`), which is what makes `./api/client.js` right from a pretty path
// too — the reason the guide taught the absolute form (C-32800 item 7).
Deno.test('the guide imports the client relatively, every time it shows one', () => {
  assertEquals(
    [...guide.matchAll(/from '([^']*client\.js)'/g)].map((m) => m[1])
      .filter((from) => from != './api/client.js'),
    [],
  )
  assert(
    /from '\.\/api\/client\.js'/.test(guide),
    'the guide shows no import at all',
  )
})

Deno.test('the guide prints every word vocab.json may not use', () => {
  // The indented block after the sentence that introduces it — the guide's
  // one code block of bare words.
  let block = guide.split(/taken:\n\n/)[1]?.split('\n\n')[0] ?? ''
  assertEquals(block.trim().split(/\s+/), RESERVED)
})

// One bullet of the component list: the names it heads with, and the
// `col` (type) pairs it prints before the sentence explaining them.
let bullets = () => {
  let section = guide.split('## The components an app has today')[1]
    ?.split('\n## ')[0] ?? ''
  return section.split('\n- ').slice(1).map((bullet) => {
    let [head, ...said] = bullet.replace(/\s+/g, ' ').split(' — ')
    return {
      names: [...head.matchAll(/`(\w+)`/g)].map((m) => m[1]),
      cols: [
        ...said.join(' — ').split('. ')[0]
          .matchAll(/`(\w+)` \(([^)]+)\)/g),
      ].map((m) => [m[1], m[2]]),
    }
  })
}

// The third list that can rot, and the one an app's code is written against:
// what `env` holds inside a worker.js, and the limits it runs under. Both are
// the platform's own — the shim decides the first, the upload's metadata the
// second — and a guide that names a door the shim does not hand over teaches
// an app to break at the first request (T-32780).
Deno.test('the guide names the doors a worker is actually given', () => {
  let section = guide.split('## Code of your own')[1]?.split('\n## ')[0] ?? ''
  assert(section, 'the guide no longer teaches worker.js')
  // Every `env.NAME` the section spells, minus the secrets, which are the
  // app's own names and not the platform's.
  let named = new Set(
    [...section.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]),
  )
  for (let door of ['STORE', 'FILES']) {
    assert(named.has(door), `the guide never shows env.${door}`)
    assert(SHIM.includes(`${door}: door(`), `the shim hands over no ${door}`)
  }
  for (let door of named) {
    if (door == 'STORE' || door == 'FILES') continue
    // Anything else must read as a secret the person set, not a door.
    assert(
      /app_secret_set|WEATHER_KEY/.test(section),
      `the guide shows env.${door} and never says where it came from`,
    )
  }
})

// Every route the worker example names has to be one the worker can be
// reached at. `/api/…` is the kernel's, always, so an example opening with
// `endsWith('/api/mine')` is a route that can never run — which is what the
// ninth user test copied and got the api door's own 404 for (C-32869 item 2).
Deno.test("no route in the guide's worker example is under /api/", () => {
  let section = guide.split('## Code of your own')[1]?.split('\n## ')[0] ?? ''
  let routes = [...section.matchAll(/pathname[^\n]*?'(\/[^']*)'/g)]
    .map((m) => m[1])
  assert(routes.length, 'the example names no routes at all')
  assertEquals(routes.filter((r) => r.split('/').includes('api')), [])
})

Deno.test('the guide prints the limits an app is really held to', async () => {
  let section = guide.split('## Code of your own')[1]?.split('\n## ')[0] ?? ''
  let meta: { limits: { cpu_ms: number; subrequests: number } } = {
    limits: {
      cpu_ms: 0,
      subrequests: 0,
    },
  }
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let form = await new Request(input as string, init).formData()
    meta = JSON.parse(await (form.get('metadata') as File).text())
    return Response.json({ success: true, errors: [], result: {} })
  }) as typeof fetch
  try {
    await upload({ CF_ACCOUNT: 'a', CF_WORKERS_TOKEN: 't' } as Env, 'a/b', [])
  } finally {
    globalThis.fetch = was
  }
  assert(
    section.includes(`${meta.limits.cpu_ms}ms of CPU`),
    `the guide does not say ${meta.limits.cpu_ms}ms of CPU`,
  )
  assert(
    section.includes(`${meta.limits.subrequests} subrequests`),
    `the guide does not say ${meta.limits.subrequests} subrequests`,
  )
})

// The fifth list that can rot, and the one a person's data rides on: what
// sharing an app costs them. An app is a plugin (T-32890), so the guide has to
// name every tool that makes one — a missing verb is a door nobody finds — and
// say the two things that are not obvious from the names: an installed copy
// shares nothing but the code, and it is pinned until someone moves it.
Deno.test('the guide teaches every tool that shares an app', () => {
  let section = guide.split('## Sharing an app')[1]?.split('\n## ')[0] ?? ''
  assert(section, 'the guide never teaches publishing')
  for (
    let tool of TOOLS.map((t) => t.name).filter((n) =>
      /^app_(publish|unpublish|published|install|update)$/.test(n)
    )
  ) {
    assert(section.includes(tool), `the guide never names ${tool}`)
  }
  assert(
    /nothing but the code/.test(section),
    'the guide never says what an installed app shares',
  )
  assert(/PINNED|pinned/.test(section), 'the guide never says what pinning is')
})

Deno.test('the guide prints every column of every component it lists', () => {
  let listed = bullets()
  let named = listed.flatMap((b) => b.names)
  // A parse that found nothing would pass every assertion below.
  assert(named.includes('doc') && named.includes('blob'), named.join(' '))
  for (let { names, cols } of listed) {
    for (let name of names) {
      assert(comps[name], `the guide lists ${name}, which is no component`)
      assertEquals(
        cols,
        Object.entries(comps[name]).map(([col, t]) => [col, typeName(t)]),
        name,
      )
    }
  }
})

// The sixth list that can rot, and the one a person's own domain rides on
// (T-33038): the name they are told to point a CNAME at. It is route.ts's
// `ORIGIN` and nowhere else, because a guide teaching a target that is not
// ours teaches a domain that never comes up — and the person has no way to
// tell the difference between that and waiting. The three tools have to be
// named too: a verb nobody is pointed at is a verb nobody finds.
Deno.test('the guide and its page point a domain where the code does', () => {
  let section = guide.split('## A domain of their own')[1]
    ?.split('\n## ')[0] ?? ''
  assert(section, 'the guide never teaches a custom domain')
  for (let tool of TOOLS.map((t) => t.name).filter((n) => /^domain_/.test(n))) {
    assert(section.includes(tool), `the guide never names ${tool}`)
  }
  for (
    let [where, text] of [['guide', section], ['page', pageText('domains')]]
  ) {
    assert(text.includes(ORIGIN), `the ${where} never says ${ORIGIN}`)
    assertEquals(
      [...text.matchAll(/\borigin[a-z0-9.-]*\.yaks\.app/g)].map((m) => m[0])
        .filter((host) => host != ORIGIN),
      [],
      `the ${where} names an origin that is not ours`,
    )
  }
})

// The clipping page teaches JSON-LD extraction as code somebody copies whole
// (T-33614), and a schema.org document is messier than an example makes it
// look: one object or a `@graph` of them, a value that is a string here and
// an object there, instructions in four shapes. So the page's own helpers are
// lifted out of it and run against a document wearing all of that. What is
// NOT exercised is the HTMLRewriter pass around them, which needs the Workers
// runtime; the helpers are where every shape is decided.
// The page's indented code blocks, whole: a block runs from its first
// indented line through every indented or blank line after it, since the
// examples have blank lines inside them.
let fenced = (slug: string) => {
  let out: string[] = []
  let block: string[] = []
  for (let line of pageText(slug).split('\n')) {
    if (line.startsWith('    ')) block.push(line.slice(4))
    else if (line.trim() == '') block.length && block.push('')
    else {
      if (block.length) out.push(block.join('\n').trimEnd())
      block = []
    }
  }
  if (block.length) out.push(block.join('\n').trimEnd())
  return out
}

let helpers = () => {
  let code = fenced('clipping')
    .filter((b) => /^let (things|minutes) =/m.test(b))
    .join('\n')
  assert(/let cooking =/.test(code), 'the page no longer shows the recipe read')
  return new Function(
    `${code}\nreturn {things, str, src, typed, minutes, steps, cooking}`,
  )() as {
    things: (blocks: string[]) => Record<string, unknown>[]
    str: (v: unknown) => string
    src: (v: unknown) => string
    minutes: (iso: unknown) => number
    cooking: (blocks: string[]) => {
      title: string
      serves: number | null
      minutes: number | null
      picture: string
      body: string
    } | null
  }
}

// Every awkwardness on one page: a `@graph`, a WebSite beside the Recipe, an
// ImageObject instead of a URL, a yield that is a sentence, a section holding
// the steps, and a block of broken JSON before all of it.
let PAGE = [
  '{"@type": "Recipe", "name": "not json",',
  JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Some Site' },
      {
        '@type': ['Recipe', 'NewsArticle'],
        name: 'Lemon drizzle',
        recipeYield: '8 servings',
        totalTime: 'PT1H20M',
        image: { '@type': 'ImageObject', url: 'https://x.test/cake.jpg' },
        recipeIngredient: ['3 lemons', '200g butter'],
        recipeInstructions: [{
          '@type': 'HowToSection',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Zest the lemons.' },
            { '@type': 'HowToStep', text: 'Cream the butter.' },
          ],
        }],
      },
    ],
  }),
]

Deno.test("the clipping page's own reader handles a schema.org page", () => {
  let h = helpers()
  // The broken block is skipped rather than fatal, and @graph is flattened.
  assertEquals(h.things(PAGE).length, 3)
  let dish = h.cooking(PAGE)!
  assert(dish, 'no recipe was found')
  assertEquals(dish.title, 'Lemon drizzle')
  assertEquals(dish.serves, 8)
  assertEquals(dish.minutes, 80)
  assertEquals(dish.picture, 'https://x.test/cake.jpg')
  assert(dish.body.includes('- 3 lemons'), dish.body)
  assert(dish.body.includes('1. Zest the lemons.'), dish.body)
  assert(dish.body.includes('2. Cream the butter.'), dish.body)
  // A page with no Recipe still clips — as a doc and a source, never a
  // refusal.
  assertEquals(h.cooking(['{"@type": "WebSite", "name": "Some Site"}']), null)
  assertEquals(h.minutes('PT30M'), 30)
  assertEquals(h.minutes(undefined), 0)
  assertEquals(h.str({ name: 'a name' }), 'a name')
  assertEquals(h.src(['https://x.test/a.png']), 'https://x.test/a.png')
})
