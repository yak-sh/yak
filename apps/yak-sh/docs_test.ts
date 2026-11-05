// What an agent reads at yak.sh, asked of the app's worker as yaks.app asks it.
import { equal, match, test } from '@yaks/testing'
import worker from './worker.ts'
import { INSTALL, SECTIONS } from './site.ts'

let get = async (url: string, headers: HeadersInit = {}) => {
  let res = await worker.fetch(new Request(url, { headers }))
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    text: await res.text(),
  }
}

test('llms.txt says what yak is and links pages the site answers', async () => {
  let { status, type, text } = await get('https://yak.sh/llms.txt')
  equal([status, type], [200, 'text/plain; charset=utf-8'])
  match(text, /^# yak\.sh\n\n> `yak` is a command line/)
  let own = [...text.matchAll(/\]\((https:\/\/yak\.sh\/[^)]*)\)/g)]
    .map((m) => m[1])
  equal(own, ['https://yak.sh/setup.md', 'https://yak.sh/index.md'])
  for (let url of own) {
    equal((await get(url)).type, 'text/markdown; charset=utf-8')
  }
})

test('the pages link under the address the visitor asked for', async () => {
  let { text } = await get('https://jeff.yaks.app/yak-sh/llms.txt')
  match(text, /\(https:\/\/jeff\.yaks\.app\/yak-sh\/setup\.md\)/)
  let domain = await get('https://jeff.yaks.app/yak-sh/llms.txt', {
    'x-yak-address': 'https://yak.sh/llms.txt',
  })
  match(domain.text, /\(https:\/\/yak\.sh\/setup\.md\)/)
})

test('setup.md holds the steps from installing yak to an app online', async () => {
  let { text } = await get('https://yak.sh/setup.md')
  for (
    let line of [INSTALL, 'yak init', 'yak auth yaks.app', 'yak app_deploy']
  ) match(text, new RegExp(`\n${line}`))
  match(text, /https:\/\/yaks\.app\/agent\.md/)
})

test("index.md is every section, without the page's own blocks", async () => {
  let { text } = await get('https://yak.sh/index.md')
  for (let s of SECTIONS) {
    match(text, new RegExp(`^#+ ${RegExp.escape(s.title)}$`, 'm'))
  }
  equal(/```(declared|outbox|reply|session)/.test(text), false)
  match(text, /```mcp\ntask_update/)
})

test('anything else falls through to the files', async () => {
  for (let url of ['https://yak.sh/', 'https://yak.sh/site.ts']) {
    equal((await get(url)).status, 404)
  }
})
