// Filing from a browser, end to end against a booted server: the door a
// tab writes through (/page) and the door its badge reads through
// (/query) must name the same page. They never exchange a normalized
// string — each one canonicalizes through the `url` PropType — so this
// drives them with the SPELLINGS a browser actually hands over (a
// campaign-tagged address, a fragment, a trailing slash) and asserts the
// two halves meet.
import { assertEquals, assertMatch } from '@std/assert'

// A temp HOME before the import: freeze.ts fixes ~/.tasks/frozen at load,
// and a test must never write an archive into the owner's.
let home = Deno.makeTempDirSync({ prefix: 'tasks-page-home-' })
Deno.env.set('HOME', home)
// The server reads its port from the environment, so claim an ephemeral one
// and give the seat back before it boots (subs_live_test.ts does the same).
let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
let port = (seat.addr as Deno.NetAddr).port
seat.close()
Deno.env.set('PORT', String(port))
Deno.env.set('DB_PATH', ':memory:')
await import('./server.ts')

let U = `127.0.0.1:${port}`
let alone = { sanitizeOps: false, sanitizeResources: false }

type Filed = { page: string; url: string; filed: string[]; msg: string }
let file = async (body: unknown): Promise<Filed> => {
  let res = await fetch(`http://${U}/page`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let text = await res.text()
  if (!res.ok) throw new Error(`page refused: ${text}`)
  return JSON.parse(text)
}

type Back = { from: string; via: string; title: string }
type Hit = {
  entity: { eid: string; num: number }
  web?: { url: string }
  backlinks?: Back[]
}
// The badge itself: the RAW address of the tab, backlinks on. `.web.url`
// is the explicit spelling because repo.url shares the bare name; the
// value is QUOTED because '&' separates filters and a page address
// carries one the moment it has two query parameters.
let badge = async (url: string): Promise<Hit[]> => {
  let res = await fetch(
    `http://${U}/query?${
      encodeURIComponent(`.web.url="${url}"`)
    }&kind=web&backlinks=1`,
  )
  if (!res.ok) throw new Error(`query refused: ${await res.text()}`)
  return res.json()
}

// Two query parameters on purpose: an ordinary address carries the very
// character the filter grammar separates on.
let PAGE = 'https://witness.test/article?id=7&page=2'

Deno.test(
  'filing a page mints it once, however the tab spells it',
  alone,
  async () => {
    let one = await file({ url: PAGE, title: 'The Article', line: 'Read this' })
    assertMatch(one.page, /^W-\d+$/)
    assertEquals(one.url, PAGE)
    assertEquals(one.filed.length, 1)
    assertMatch(one.filed[0], /^T-\d+$/)

    // The same page, wearing a campaign and a fragment — one entity, and
    // the second filing joins it rather than forking it.
    let two = await file({
      url: `${PAGE}&utm_source=newsletter&utm_medium=email#intro`,
      line: 'P1 .domain=Eng And this',
    })
    assertEquals(two.page, one.page)
    assertEquals(two.url, PAGE)

    let hits = await badge(`${PAGE}#somewhere-else`)
    assertEquals(hits.length, 1)
    assertEquals(`W-${hits[0].entity.num}`, one.page)
    assertEquals(hits[0].web?.url, PAGE)
    // One query answers the whole panel: who points here, how, and what
    // they are called.
    let refs = (hits[0].backlinks ?? []).filter((b) => b.via == 'about')
    assertEquals(refs.map((b) => b.title).sort(), ['And this', 'Read this'])
    assertEquals(
      refs.map((b) => b.from).sort(),
      [one.filed[0], two.filed[0]].sort(),
    )
  },
)

Deno.test('a page with no line is just the page', alone, async () => {
  let out = await file({ url: 'https://witness.test/bare', title: 'Bare' })
  assertEquals(out.filed, [])
  let hits = await badge('https://witness.test/bare/')
  assertEquals(hits.length, 1)
  assertEquals(hits[0].backlinks, [])
})

Deno.test(
  'the line is the one vocabulary, and its refusal is words',
  alone,
  async () => {
    let out = await file({
      url: 'https://witness.test/verb',
      line: ':nonsense x',
    })
    assertEquals(out.filed, [])
    assertEquals(out.msg, 'not a command: nonsense')
  },
)

Deno.test(
  'a captured DOM archives as witnessed, dated and attributed',
  alone,
  async () => {
    let out = await file({
      url: 'https://witness.test/paywalled',
      title: 'Paywalled',
      html:
        '<html><head><title>Paywalled</title></head><body><p>subscriber text</p>' +
        '<script>alert(1)</script><img src="https://tracker.test/p.gif"></body></html>',
    })
    let hits = await badge('https://witness.test/paywalled')
    assertEquals(hits.length, 1)

    let res = await fetch(`http://${U}/frozen/${hits[0].entity.eid}.html`)
    let html = await res.text()
    assertEquals(res.status, 200)
    // Scrubbed on the way in — the bytes are the witness, not the page's
    // scripts or its tracker.
    assertEquals(html.includes('subscriber text'), true)
    assertEquals(html.includes('alert(1)'), false)
    assertEquals(html.includes('tracker.test'), false)
    // Memento: when these bytes were true, and where they were said.
    assertMatch(res.headers.get('memento-datetime') ?? '', /GMT$/)
    assertEquals(
      res.headers.get('link'),
      '<https://witness.test/paywalled>; rel="original"',
    )
    assertEquals(out.url, 'https://witness.test/paywalled')
  },
)

Deno.test("a non-page address is the typist's news", alone, async () => {
  let res = await fetch(`http://${U}/page`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'not a url' }),
  })
  assertEquals(res.status, 400)
  await res.text()
  Deno.removeSync(home, { recursive: true })
})
