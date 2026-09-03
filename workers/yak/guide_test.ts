// The guide is the only page an agent building an app reads (mcp.ts serves it
// as the connector's one resource), so a list printed there has to be true.
// The reserved words are the list that can rot: they come from the platform's
// vocabulary, which grows, and a manifest is refused against the code's list,
// never the page's (C-32624 item 1).
import { assertEquals } from '@std/assert'
import { RESERVED } from '../../src/store/vocab.ts'

let guide = Deno.readTextFileSync(
  new URL('./public/guide.md', import.meta.url),
)

Deno.test('the guide prints every word vocab.json may not use', () => {
  // The indented block after the sentence that introduces it — the guide's
  // one code block of bare words.
  let block = guide.split(/taken:\n\n/)[1]?.split('\n\n')[0] ?? ''
  assertEquals(block.trim().split(/\s+/), RESERVED)
})
