// The guide is the only page an agent building an app reads (mcp.ts serves it
// as the connector's one resource), so a list printed there has to be true.
// Two lists can rot, and both come from the platform's vocabulary, which
// grows: the reserved words a manifest is refused against (the code's list,
// never the page's — C-32624 item 1), and the components an app has, whose
// COLUMNS and types are what a refusal now spells and what the seventh user
// test had to guess five times over (C-32675 items 2 and 3).
import { assert, assertEquals } from '@std/assert'
import { RESERVED } from '../../src/store/vocab.ts'
import { comps, typeName } from '../../src/types.ts'

let guide = Deno.readTextFileSync(
  new URL('./public/guide.md', import.meta.url),
)

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
