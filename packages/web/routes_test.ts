// The page's script, as the browser door serves it, loads in a browser.
import * as io from '@yaks/file/io'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { routes } from './routes.ts'
import { OUTDATED } from './outlived.ts'

// Every workspace package with a views facet, and the app that mounts them:
// what any configured page can bundle.
let viewed = async () => {
  let names = ['@yaks/browse']
  for await (let dir of io.readDir(new URL('../', import.meta.url))) {
    let at = new URL(`../${dir.name}/package.json`, import.meta.url)
    let json = await io.readTextFile(at).then(JSON.parse, () => null)
    if (json?.exports?.['./views']) names.push(json.name)
  }
  return names
}

test('the served bundle imports nothing a browser cannot load', async () => {
  let vocab = loadVocab([])
  let stopping = new AbortController()
  let app = routes({
    config: { db: ':memory:', plugins: await viewed() },
    vocab,
    graph: graph({ storage: ram(vocab), vocab }),
    stopping: stopping.signal,
  }).find((r) => r.path == '/web/app.js')!
  try {
    let served = await app.handle(new Request('http://x/web/app.js'))
    equal(served.status, 200)
    let code = await served.text()
    equal(code.match(/(?:from|import)\s*["']node:[\w/]+["']/g), null)
  } finally {
    stopping.abort()
  }
})

test('a page telling of its own outdated code is no break; any other is', async () => {
  let vocab = loadVocab([])
  let told: string[] = []
  let report = routes({
    vocab,
    graph: graph({ storage: ram(vocab), vocab }),
    report: (e) => void told.push((e as Error).message),
  }).find((r) => r.path == '/api/report')!
  let page = (message: string) =>
    report.handle(
      new Request('http://x/api/report', {
        method: 'POST',
        body: JSON.stringify({ message, mechanism: 'console' }),
      }),
    )
  await page(`live client — Refused: ${OUTDATED.message}`)
  await page('live client — Refused: something else')
  equal(told, ['live client — Refused: something else'])
})
