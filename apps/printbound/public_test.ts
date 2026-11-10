import { equal, ok, test } from '@yaks/testing'
import { publicPage } from './public.ts'
import routes from './public-routes.json' with { type: 'json' }
import { parseHTML } from 'linkedom'

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
let reads: string[] = []
let env = {
  FILES: {
    fetch: (path: string) => {
      reads.push(path)
      return Promise.resolve(
        new Response(content.get(path), {
          status: content.has(path) ? 200 : 404,
        }),
      )
    },
  },
}

test('a guide keeps its content and links under the preview mount and custom domain', async () => {
  for (
    let prefix of [
      'https://checks.yaks.app/printbound-preview',
      'https://printbound.net',
    ]
  ) {
    let answer = await publicPage(
      new Request(prefix + '/print-your-chatgpt-book'),
      env,
    )
    equal(answer?.status, 200)
    let text = await answer!.text()
    equal(
      parseHTML(text).document.querySelector('article')!.textContent,
      parseHTML(content.get('/public/print-your-chatgpt-book.html')!).document
        .querySelector('article')!.textContent,
    )
    ok(text.includes(`href="${prefix}/make-a-picture-book-in-chatgpt`))
    ok(!text.includes('src="/script.js'))
    ok(!text.includes('<!--'))
  }
})

test('public reading routes support HEAD and refuse to read a saved document or source', async () => {
  let response = await publicPage(
    new Request('https://checks.yaks.app/printbound-preview/privacy.html', {
      method: 'HEAD',
    }),
    env,
  )
  equal(response?.status, 200)
  equal(await response!.text(), '')
  let count = reads.length
  for (
    let path of [
      '/source.ts',
      '/public-routes.json',
      '/studio/book?id=private',
      '/public/../worker.ts',
    ]
  ) {
    equal(
      await publicPage(
        new Request('https://checks.yaks.app/printbound-preview' + path),
        env,
      ),
      null,
    )
  }
  equal(reads.length, count)
  equal(
    (await publicPage(new Request('https://printbound.net/public.css'), env))
      ?.headers.get('content-type'),
    'text/css; charset=utf-8',
  )
})

test('a guide whose address has a doubled slash is the same guide', async () => {
  let answer = await publicPage(
    new Request('https://printbound.net//terms'),
    env,
  )
  equal(answer?.status, 200)
  ok((await answer!.text()).includes('href="https://printbound.net/privacy'))
})
