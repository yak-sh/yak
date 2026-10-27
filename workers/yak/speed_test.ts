// The guide's fast page (public/docs/speed.md) is an example that runs: its
// script, on its own document, against a store whose every request is
// numbered by the round it went out in, loads its data in one.
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { parseHTML } from 'linkedom'
import { test, until } from '@yaks/testing'
import { store } from './public/client.js'

// The page as the guide shows it: the indented block that opens with a
// doctype, up to the first line of prose after it.
let guide = Deno.readTextFileSync(
  new URL('./public/docs/speed.md', import.meta.url),
)
let lines = guide.split('\n')
let from = lines.indexOf('    <!doctype html>')
let to = lines.findIndex((line, i) => i > from && /^\S/.test(line))
let page = lines.slice(from, to).map((line) => line.slice(4)).join('\n')
let [, names, body] =
  /import \{([^}]*)\} from '\.\/api\/client\.js'\n([\s\S]*?)<\/script>/
    .exec(page)!

// The script, given the client's functions where its import would bind them,
// and the page's own document, parsed once.
let bound = names.split(',').map((n) => n.trim())
let Async = (async () => {}).constructor as FunctionConstructor
let script = new Async(...bound, 'document', body)
let { document } = parseHTML(page)
let run = (client: Record<string, unknown>) =>
  script(...bound.map((n) => client[n]), document)

let base = 'https://kitchen.test/kitchen/api/'
let ROWS = [
  { entity: { eid: 'r' }, recipe: {}, doc: { title: 'Soup' } },
  { entity: { eid: 'c' }, chore: {}, doc: { title: 'Dishes' } },
]

// Each request is in the round after the latest answer the page had heard
// when it asked.
let numbered = () => {
  let heard = 0
  let rounds: Record<string, number> = {}
  let fetching = stub(globalThis, 'fetch', async (url) => {
    let path = decodeURIComponent(String(url).slice(base.length))
    let round = rounds[path] = heard + 1
    await Promise.resolve()
    heard = Math.max(heard, round)
    return Response.json(
      path == 'me' ? { person: 'jo', name: 'Jo', reads: true } : ROWS,
    )
  })
  let socket = stub(
    globalThis,
    'WebSocket',
    function () {
      return { readyState: 0, send() {}, close() {} }
    },
  )
  return {
    rounds,
    [Symbol.dispose]: () => (fetching.restore(), socket.restore()),
  }
}

test("the guide's fast page loads its data in one round", async () => {
  using wire = numbered()
  await run(store(base))
  await until(() => document.querySelectorAll('li').length == 2, { poll: 0 })
  assertEquals(wire.rounds, { 'me': 1, 'query?(.recipe|.chore)&?doc': 1 })
  assertEquals(
    [...document.querySelectorAll('li')].map((li) => li.textContent),
    ['Cook: Soup', 'Do: Dishes'],
  )
  assertEquals(document.getElementById('hello')!.textContent, 'Hello, Jo.')
})
