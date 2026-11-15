// The door's half: a request says which run it speaks for, and what it writes
// carries that run and whoever the run speaks as.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { docDoc } from '@yaks/doc'
import { ram } from '@yaks/ram'
import { idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { authenticate, VIA } from './graph.ts'
import { parentVia } from '../cli/run.ts'

let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let vocab = loadVocab([sessionDoc, spine, docDoc], [idKeywords])

let host = () => {
  let s = ram(vocab, { number: true })
  let g = graph({ storage: s, vocab, plugins: [ids(vocab)] })
  g.apply([
    { entity: { eid: 's1' }, session: { id: 'abc', actor: 'p1' } },
    { entity: { eid: 'p1' }, doc: {} },
  ], { trusted: true })
  return { graph: g }
}

let asking = (said?: string) =>
  authenticate(host())(
    new Request('http://h/apply', {
      headers: said ? { [VIA]: said } : {},
    }),
  )

test('the run a request names is who its writes are by, and through', async () => {
  assertEquals(await asking('abc'), { by: 'p1', via: 's1' })
  // However the caller names it — the harness's name, the id a person says,
  // the eid — it is one run.
  assertEquals(await asking('S-1'), { by: 'p1', via: 's1' })
  assertEquals(await asking('s1'), { by: 'p1', via: 's1' })
})

test('a request naming nobody, or a run this graph never saw, is left to the host', async () => {
  assertEquals(await asking(), null)
  assertEquals(await asking('nothing-here'), null)
})

// The local MCP client reads the session of the harness that started it,
// and names that session on every request, even if a tool hook never arrives.
let helped = (session?: string): Record<string, string> => {
  let id = parentVia(
    (name) => name == 'CLAUDE_CONFIG_DIR' ? '/claude' : undefined,
    42,
    () => JSON.stringify(session ? { sessionId: session } : {}),
  )
  return id ? { [VIA]: id } : {}
}

// A tool call whose `PreToolUse` hook never reached the hook door.
let unheard = async (headers: Record<string, string>) =>
  await authenticate(host())(
    new Request('http://h/mcp', { method: 'POST', headers }),
    {
      method: 'tools/call',
      params: { _meta: { 'claudecode/toolUseId': 'toolu_never_heard' } },
    },
  )

test("a call whose hook never arrives is still its connection's session", async () => {
  assertEquals(await unheard(helped('abc')), { by: 'p1', via: 's1' })
})

test('a harness the helper cannot read says nothing, and is left to the host', async () => {
  assertEquals(helped(), {})
  assertEquals(await unheard(helped()), null)
})
