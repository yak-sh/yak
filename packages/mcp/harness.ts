// Shared test fixtures (not part of the published package — see deno.json): a
// bookshop vocabulary over an in-memory graph, and an MCP client wired to a
// server of it in the same process. The domain is a shop — books with a price
// and a status, reviews about them, members who joined — so nothing here needs
// knowledge from outside this file.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools'
import { type Options, server } from './server.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: everything in the shop has one.
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    // A book on sale, and the author who wrote it.
    book: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      description: 'a book on sale here',
      properties: {
        price: { type: 'number', description: 'what it costs, in pounds' },
        status: { enum: ['draft', 'shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // A review exists about a book — deleting the book takes its reviews too.
    review: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    // Provenance: server-owned, so the graph's stamp phase is their only
    // writer — which is what makes the authenticated actor visible in a read.
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

// The shop's own components, plus the components a call is written with: this
// server writes `call{to, args}` into the graph and waits for the result, so
// the graph's vocabulary has to declare those too (@yaks/tools `toolsDoc`).
/** The bookshop vocabulary the package's tests read and write against. */
export let shop: Vocab = loadVocab([doc, toolsDoc])

/** A graph over a fresh in-memory store. */
export let shopGraph = (): Graph =>
  graph({ storage: ram(shop, { number: true }), vocab: shop })

/** An MCP client talking to a server over this graph, in one process. */
export let connect = async (
  opts: Omit<Options, 'graph'> & { graph?: Graph } = {},
): Promise<Client> => {
  let mcp = server({ ...opts, graph: opts.graph ?? shopGraph() })
  await opts.extend?.(mcp)
  let [here, there] = InMemoryTransport.createLinkedPair()
  let client = new Client({ name: 'shop-test', version: '0.0.0' })
  await Promise.all([client.connect(here), mcp.connect(there)])
  return client
}

/** One component off a bundle, for a test that wants a column out of it. */
export let comp = (b: Bundle, name: string): Record<string, unknown> => {
  let c = b[name]
  return c && typeof c == 'object' ? { ...c } : {}
}

/** The bundles a tool returned — what is nested under `result` in the reply's
 * `structuredContent`. */
export let result = (out: { structuredContent?: unknown }): unknown => {
  let said = out.structuredContent
  return said && typeof said == 'object' && 'result' in said
    ? said.result
    : undefined
}

/** The text of a reply: its first text content block. */
export let text = (out: { content?: unknown }): string => {
  let blocks = out.content
  return Array.isArray(blocks) ? String(blocks[0]?.text ?? '') : ''
}
