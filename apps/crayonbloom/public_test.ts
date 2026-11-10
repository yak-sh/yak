import { equal, ok, test } from '@yaks/testing'
import { DOMParser, parseHTML } from 'linkedom'
import { publicPage } from './public.ts'
import { written } from './pages/prose.ts'
import routes from './public-routes.json' with { type: 'json' }
import assets from './public-assets.json' with { type: 'json' }

let content = new Map(
  await Promise.all(
    Object.values(routes).map(async (file) =>
      [
        '/public/' + file,
        await Deno.readTextFile(new URL('./public/' + file, import.meta.url)),
      ] as const
    ),
  ),
)
let seed = assets[0]
let image = new Uint8Array([137, 80, 78, 71])
let pdf = new TextEncoder().encode('%PDF-1.7\nfixture')
let env = {
  FILES: {
    fetch: (path: string) =>
      Promise.resolve(
        content.has(path)
          ? new Response(content.get(path))
          : path == '/' + seed.key
          ? new Response(image, { headers: { 'content-type': 'image/png' } })
          : path == `/public-printables/${seed.theme}/${seed.page}.pdf`
          ? new Response(pdf, {
            headers: { 'content-type': 'application/pdf' },
          })
          : new Response('Not found', { status: 404 }),
      ),
  },
}

test('a post and feed preserve published text and mounted links', async () => {
  let base = 'https://checks.yaks.app/crayonbloom-preview'
  let response = await publicPage(
    new Request(base + '/blog/unicorn-coloring-pages-for-kids'),
    env,
  )
  equal(response?.status, 200)
  let html = await response!.text()
  equal(
    parseHTML(html).document.querySelector('article')!.textContent,
    parseHTML(
      `<article>${
        written(
          content.get('/public/blog--unicorn-coloring-pages-for-kids.html')!,
        ).html
      }</article>`,
    ).document.querySelector('article')!.textContent,
  )
  ok(html.includes('href="/crayonbloom-preview/coloring-pages/unicorns"'))
  ok(html.includes('href="/crayonbloom-preview/look.css"'))
  ok(!html.includes('<script'))
  let feed = await publicPage(new Request(base + '/blog.rss'), env)
  equal(
    feed?.headers.get('content-type'),
    'application/rss+xml; charset=utf-8',
  )
  let document = new DOMParser().parseFromString(
    await feed!.text(),
    'text/xml',
  )
  equal(
    document.querySelectorAll('item').length,
    Object.keys(routes).filter((route) => route.startsWith('/blog/')).length,
  )
  ok(document.querySelector('item link')!.textContent!.startsWith(base))
})

test('a public seed grid and its printable expose only curated asset paths', async () => {
  let base = 'https://checks.yaks.app/crayonbloom-preview'
  let response = await publicPage(
    new Request(base + '/coloring-pages/' + seed.theme),
    env,
  )
  let html = await response!.text()
  ok(html.includes(`src="/crayonbloom-preview/${seed.key}"`))
  let printable = await publicPage(
    new Request(
      `${base}/coloring-pages/${seed.theme}/printables/${seed.page}.pdf`,
    ),
    env,
  )
  equal(printable?.headers.get('content-type'), 'application/pdf')
  equal(new Uint8Array(await printable!.arrayBuffer()), pdf)
  let art = await publicPage(new Request(base + '/' + seed.key), env)
  equal(new Uint8Array(await art!.arrayBuffer()), image)
  equal(
    await publicPage(new Request(base + '/private/customer-art.png'), env),
    null,
  )
  equal(
    await publicPage(
      new Request(base + '/coloring-pages/dinosaurs/printables/private.pdf'),
      env,
    ),
    null,
  )
})

test('a doubled slash serves the page with links at the mount', async () => {
  for (
    let [address, base] of [
      ['https://crayonbloom.com//contact', '/'],
      ['https://crayonbloom.yaks.app/crayonbloom//terms', '/crayonbloom/'],
    ]
  ) {
    let response = await publicPage(new Request(address), env)
    equal(response?.status, 200)
    let html = await response!.text()
    ok(html.includes(`href="${base}blog"`), address)
    ok(!html.includes(`href="${base}/`), address)
  }
})
