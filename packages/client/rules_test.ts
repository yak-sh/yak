/// <reference lib="deno.ns" />
// Declared rules in a page's graph: its own rules on every change, the
// server's rules marked optimistic as it writes, and the server's answer as
// the truth afterwards.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { replicate } from '@yaks/sync'
import { loadVocab } from '@yaks/vocab'
import { client } from './client.ts'

let text = { type: 'string' }
let vocab = loadVocab({
  $defs: {
    doc: { component: true, type: 'object', properties: { title: text } },
    shelf: { component: true, type: 'object', properties: { aisle: text } },
    sticker: { component: true, type: 'object', properties: { by: text } },
    flag: {
      component: true,
      type: 'object',
      properties: { level: { type: 'string', enum: ['ok'] } },
    },
    Pick: {
      component: true,
      type: 'object',
      sync: 'none',
      durable: 'connection',
      properties: { seen: { type: 'boolean' } },
    },
    // The server's, run early by the page.
    shelve: {
      rule: true,
      optimistic: true,
      match: '.doc, +!shelf, +shelf.aisle=Z',
    },
    // A validation: it writes what the vocabulary refuses.
    guard: {
      rule: true,
      optimistic: true,
      match: '.doc.title=bad, +!flag, +flag.level=boom',
    },
    // The server's alone.
    stick: { rule: true, match: '.doc, +!sticker, +sticker.by=server' },
    // The page's own.
    pick: { rule: true, match: '.doc, +!Pick, +Pick.seen=true' },
  },
})

// A page over a server graph in this process: every POST lands in `sent`, and
// the server refuses while `refuse` is set.
let page = () => {
  let server = graph({ storage: ram(vocab), vocab })
  let sent: Bundle[][] = []
  let state = { refuse: false }
  let c = client(vocab, [], {
    url: 'http://page.test',
    vault: false,
    wireVault: false,
    report: () => {},
    fetch: async (request) => {
      let batch = await request.json() as Bundle[]
      sent.push(batch)
      if (state.refuse) {
        return Response.json({ error: 'Refused', message: 'no' }, {
          status: 409,
        })
      }
      return Response.json(await server.apply(batch))
    },
  })
  let at = (eid: string, comp: string) => c.ent(eid)?.[comp]
  return { server, sent, state, c, at, idle: () => c.wire!.idle() }
}

test('a write shows its optimistic rule at once, and the server adds its own', async () => {
  let { c, at, idle, server } = page()
  c.mutate([{ entity: { eid: 'd1' }, doc: { title: 'Dune' } }])
  assertEquals(at('d1', 'shelf'), { aisle: 'Z' })
  assertEquals(at('d1', 'sticker'), undefined)
  assertEquals(at('d1', 'Pick'), { seen: true })
  await idle()
  assertEquals(at('d1', 'shelf'), { aisle: 'Z' })
  assertEquals(at('d1', 'sticker'), { by: 'server' })
  // The page's own component never left it.
  assertEquals((await server.get(['d1']))[0].Pick, undefined)
  c.close()
})

test('a refused write takes back what its rules added', async () => {
  let { c, at, idle, state } = page()
  state.refuse = true
  c.mutate([{ entity: { eid: 'd1' }, doc: { title: 'Dune' } }])
  assertEquals(at('d1', 'shelf'), { aisle: 'Z' })
  await idle()
  assertEquals(at('d1', 'doc'), undefined)
  assertEquals(at('d1', 'shelf'), undefined)
  assertEquals(at('d1', 'Pick'), undefined)
  c.close()
})

test("the server's answer replaces what the page's rule guessed", async () => {
  let { c, at, idle, server } = page()
  // The server holds a shelf the page was never sent.
  await server.apply([{
    entity: { eid: 'd1' },
    doc: { title: 'Dune' },
    shelf: { aisle: 'Q' },
  }])
  await replicate(c.graph, [{ entity: { eid: 'd1' }, doc: { title: 'Dune' } }])
  c.mutate([{ entity: { eid: 'd1' }, doc: { title: 'Dune II' } }])
  assertEquals(at('d1', 'shelf'), { aisle: 'Z' })
  await idle()
  assertEquals(at('d1', 'shelf'), undefined)
  assertEquals(at('d1', 'doc'), { title: 'Dune II' })
  c.close()
})

test('an optimistic rule that refuses stops the write before it is sent', () => {
  let { c, at, sent } = page()
  assertThrows(() =>
    c.mutate([{ entity: { eid: 'd1' }, doc: { title: 'bad' } }])
  )
  assertEquals(at('d1', 'doc'), undefined)
  assertEquals(sent, [])
  c.close()
})
