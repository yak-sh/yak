// A catalog card's logo door answers only an SVG document: the broker's, kept
// once fetched, from whichever of its addresses answers one, else the
// service's initial, reported.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import { platform } from './serving-probe.ts'
import { logoDoor } from './catalog.ts'

let SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>'
let PAGE = '<!doctype html><html><body><svg></svg></body></html>'
let OWN = 'https://app.nango.dev/images/template-logos/hub.svg'
let MIRROR =
  'https://raw.githubusercontent.com/NangoHQ/nango/master/packages/webapp/public/images/template-logos/hub.svg'

// A door over a kept list naming `hub`, whose addresses answer as `answers`
// says (a page where it says nothing), and what it asked and reported.
let door = async (answers: Record<string, string> = {}) => {
  let reports: Bundle[] = [], asked: string[] = []
  let { env } = platform({
    ERRORS: { send: (rows) => (reports.push(...rows), Promise.resolve()) },
  })
  await env.BLOBS.put(
    'platform/catalog/nango.json',
    JSON.stringify({
      at: Date.now(),
      closed: [],
      listings: [{
        name: 'hub',
        title: 'HubSpot',
        logo: OWN,
        categories: [],
        hosts: ['api.hub.example'],
        connects: 'signin',
      }],
    }),
  )
  let fetcher = ((at: string) => {
    asked.push(at)
    return Promise.resolve(
      new Response(answers[at] ?? PAGE, {
        headers: {
          'content-type': answers[at] ? 'image/svg+xml' : 'text/html',
        },
      }),
    )
  }) as typeof fetch
  let get = (name = 'hub') =>
    within(env, {}, async () => {
      let res = (await logoDoor(env, `/connections/logo/${name}`, fetcher))!
      return {
        status: res.status,
        body: await res.text(),
        cache: res.headers.get('cache-control'),
      }
    })
  return { get, asked, reports }
}

let WEEK = 'public, max-age=604800'

test('a logo is served as its address answers it, and kept', async () => {
  let d = await door({ [OWN]: SVG })
  equal(await d.get(), { status: 200, body: SVG, cache: WEEK })
  equal(await d.get(), { status: 200, body: SVG, cache: WEEK })
  equal(d.asked, [OWN])
})

test("a logo too big for an integration's row is still served", async () => {
  let big = SVG.replace('<path', `<desc>${'x'.repeat(300_000)}</desc><path`)
  let d = await door({ [OWN]: big })
  equal((await d.get()).body.length, big.length)
})

test('a page answered for a logo is never relayed; its mirror stands in', async () => {
  let d = await door({ [MIRROR]: SVG })
  equal(await d.get(), { status: 200, body: SVG, cache: WEEK })
  equal(d.asked, [OWN, MIRROR])
  equal(d.reports.length, 0)
})

test('a mirror that links to another logo is followed to it', async () => {
  let shared = MIRROR.replace('hub.svg', 'hubspot.svg')
  let d = await door({ [MIRROR]: 'hubspot.svg\n', [shared]: SVG })
  equal(await d.get(), { status: 200, body: SVG, cache: WEEK })
  equal(d.asked, [OWN, MIRROR, shared])
})

test('a service no address answers for wears its initial, reported', async () => {
  let d = await door()
  let { status, body, cache } = await d.get()
  equal([status, cache], [200, 'public, max-age=3600'])
  equal([body.startsWith('<svg'), body.includes('>H</text>')], [true, true])
  equal(d.reports.length > 0, true)
  // Not kept: asked again the next time.
  await d.get()
  equal(d.asked, [OWN, MIRROR, OWN, MIRROR])
})

test('a name the list does not hold is not found', async () => {
  let d = await door({ [OWN]: SVG })
  equal((await d.get('nope')).status, 404)
  equal(d.asked, [])
})
