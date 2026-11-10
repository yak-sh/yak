import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { relative } from './request.ts'
import { GUIDES, site } from './site.ts'

// The app's files as its FILES binding hands them over, and the kit's sheets
// where the platform puts them beside an app that names @yaks/ui.
let reads: string[] = []
let env = {
  FILES: {
    fetch: async (path: string) => {
      reads.push(path)
      let file = path.startsWith('/__packages/@yaks/ui/')
        ? new URL('../../packages/ui/' + path.slice(21), import.meta.url)
        : new URL('.' + path, import.meta.url)
      try {
        return new Response(await Deno.readTextFile(file))
      } catch {
        return new Response('not found', { status: 404 })
      }
    },
  },
}
// The app's two addresses: under its space, and at its own domain.
let PLACES: [string, Record<string, string>][] = [
  ['https://checks.yaks.app/printbound-preview/', {
    'x-yak-app': 'printbound-preview',
  }],
  ['https://printbound.net/', {
    'x-yak-app': 'printbound',
    'x-yak-mount': '/',
  }],
]
let ask = (at: string, place = PLACES[1], method = 'GET') =>
  site(
    relative(new Request(place[0] + at, { method, headers: place[1] })),
    env,
  )
let page = async (at: string, place = PLACES[1]) => {
  let answer = await ask(at, place)
  equal(answer?.status, 200)
  equal(answer!.headers.get('content-type'), 'text/html; charset=utf-8')
  return parseHTML(await answer!.text()).document
}
let hrefs = (document: Document, within: string) =>
  [...document.querySelectorAll(within + ' a[href]')].map((a) =>
    a.getAttribute('href')!
  )

test('the home page links its studio, guides, look and pictures from the address it is opened at', async () => {
  for (let place of PLACES) {
    let home = await page('', place), base = place[0]
    ok(home.querySelector('h1')!.textContent!.includes('made real.'))
    equal(
      home.querySelector('link[rel=stylesheet]')!.getAttribute('href'),
      base + 'look.css',
    )
    let links = hrefs(home, 'body')
    for (let to of ['studio#new', 'make-a-picture-book-in-chatgpt', '#how']) {
      ok(links.includes(base + to), to)
    }
    ok(links.every((href) => /^(#main$|https:|mailto:)/.test(href)))
    equal(
      home.querySelector('.Bookshot img')!.getAttribute('src'),
      base + 'img/cover.webp',
    )
  }
})

test('every guide and policy is read under its cover, in the words of its file', async () => {
  for (let name of GUIDES) {
    let guide = await page(name)
    let source = await Deno.readTextFile(
      new URL(`./pages/${name}.md`, import.meta.url),
    )
    equal(
      guide.querySelector('.Cover h1')!.textContent,
      /^title: (.*)$/m.exec(source)![1],
    )
    let words = guide.querySelector('.Body')!.textContent!
    ok(words.trim().length > 100, name)
    ok(!guide.documentElement.outerHTML.includes('deno-fmt'))
  }
})

test('a guide links the app from its address, its own headings in place, and copies its prompt', async () => {
  for (let place of PLACES) {
    let guide = await page('make-a-picture-book-in-chatgpt', place)
    let links = hrefs(guide, '.Body')
    ok(links.includes(place[0] + 'print-your-chatgpt-book'))
    ok(links.some((href) => href.startsWith('#')))
    ok(links.every((href) => /^(#|https:|mailto:)/.test(href)), links.join())
    let prompt = guide.querySelector('.Prompt')!
    equal(prompt.querySelector('button[data-copy]')!.textContent, 'Copy')
    ok(prompt.querySelector('pre')!.textContent!.length > 100)
    equal(
      guide.querySelector('script[src]')!.getAttribute('src'),
      place[0] + 'copy.js',
    )
  }
})

test('a doubled slash, a trailing slash and .html name the same page', async () => {
  for (let at of ['/terms', 'terms/', 'terms.html']) {
    let terms = await page(at)
    equal(terms.querySelector('h1')!.textContent, 'Terms of Service')
    ok(hrefs(terms, 'footer').includes('https://printbound.net/privacy'))
  }
})

test('the look is the theme, then the kit’s sheets, then the skin', async () => {
  let answer = await ask('look.css')
  equal(answer!.headers.get('content-type'), 'text/css; charset=utf-8')
  let css = await answer!.text()
  let at = [
    '--night-900:',
    '.Surface_Press',
    '.Button {',
    '.Button-go,',
    '.Hero',
  ]
    .map((mark) => css.indexOf(mark))
  ok(at.every((n, i) => n >= 0 && (i == 0 || n > at[i - 1])), at.join())
})

test('the studio’s page file wears the bar and the foot', async () => {
  let studio = await page('studio', PLACES[0])
  ok(studio.querySelector('header [data-account]'))
  ok(studio.querySelector('main#desk'))
  ok(hrefs(studio, 'footer').includes(PLACES[0][0] + 'terms'))
  ok(studio.querySelector('script[type=module][src$="studio.ts"]'))
})

test('files that name the app say the address it is opened at', async () => {
  for (let name of ['llms.txt', 'sitemap.xml', 'robots.txt']) {
    let text = await (await ask(name, PLACES[0]))!.text()
    ok(text.includes(PLACES[0][0]), name)
    ok(!text.includes('__APP_BASE__'), name)
  }
})

test('HEAD answers without a body, and the door reads no source or saved book', async () => {
  let head = await ask('privacy.html', PLACES[0], 'HEAD')
  equal(head?.status, 200)
  equal(await head!.text(), '')
  let count = reads.length
  for (
    let at of [
      'source.ts',
      'worker.ts',
      'vocab.json',
      'pages/terms.md',
      'look/skin.css',
      'studio/book?id=private',
      'fonts/%2e%2e/worker.ts',
      'img/..%2fworker.ts',
    ]
  ) equal(await ask(at), null, at)
  equal(await ask('terms', PLACES[1], 'POST'), null)
  equal(reads.length, count)
  await ask('fonts/fraunces-latin.woff2')
  equal(reads.at(-1), '/fonts/fraunces-latin.woff2')
})
