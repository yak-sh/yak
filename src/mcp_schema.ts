// The output side of the MCP tool contract. A tool that answers in JSON must
// say what shape that JSON has — `outputSchema` on the tool, `structuredContent`
// on the reply (MCP 2025-06-18) — so a caller parses a described value instead
// of guessing at a text blob.
//
// The bundle schema is not hand-written: it IS the vocabulary. `bundleSchema()`
// reads the loaded @yaks/vocab — the same one src/vocab/fleet_vocab.ts projects
// from the Rust contract — and emits the entity spine plus one object per
// declared component, each carrying its readable columns at their declared
// types. Add a component to the contract and it appears here with nobody
// editing this file. Everything else in this module is a small explicit schema
// for a tool whose reply has its own shape (an apply result, the canvas view,
// the work lane).
//
// @yaks/mcp inherits the pattern rather than a copy: `bundleSchema(vocab)` takes
// any Vocab, so the package can serve an app's own vocabulary the same way.

import { z } from 'zod'
import type { Column, Vocab } from '@yaks/vocab'
import { fleetVocab } from './vocab/fleet_vocab.ts'

// A column's value as it reads back. Every column is nullable (a cleared column
// reads null) and optional (a patch touches what it names), and an enum reads
// as its members. `.catch` is deliberately absent: this schema DESCRIBES the
// reply, and a reply that doesn't match is a bug to see, not to coerce.
let columnSchema = (col: Column): z.ZodTypeAny =>
  col.category == 'enum' && col.values?.length
    ? z.enum(col.values as [string, ...string[]])
    : col.scalar == 'bool'
    ? z.boolean()
    : col.scalar == 'number' || col.scalar == 'priority'
    ? z.number()
    : z.string()

// The four stamp components carry `via` — the instrument that made the write.
// On the wire it is either the raw eid or, once client.ts `jsonAuthored()` has
// resolved it against the rows in hand, the instrument described (client.ts
// viaOf). One column, two readings, so the schema says both.
let via = z.union([
  z.string(),
  z.object({
    id: z.string(),
    kind: z.string().optional(),
    title: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    persona: z.object({
      id: z.string(),
      kind: z.string().optional(),
      title: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough(),
])

// One component as it appears in a bundle: a flat bag of its readable columns
// (writable ∪ stamped). Passthrough, never strict — a reader must not break on
// a column the server learned to send after this client was written. The
// component itself is optional but never nullable: a read OMITS what an entity
// doesn't carry, and `comp: null` is a WRITE ("delete this component") that
// lives in applySchema, not here.
let compSchema = (vocab: Vocab, name: string) =>
  z.object(
    Object.fromEntries(
      vocab.columns(name).map((prop) => [
        prop,
        (prop == 'via' ? via : columnSchema(vocab.column(name, prop)!))
          .nullable().optional(),
      ]),
    ),
  ).passthrough()

// An edge as the read faces spell it: the relation plus the entity at the far
// end, in human id form (client.ts edgesOf).
let refSchema = z.object({ type: z.string(), child: z.string() }).passthrough()
let backrefSchema = z.object({ type: z.string(), parent: z.string() })
  .passthrough()

// THE bundle: `{kind, entity: {eid, num}, <comp>: {<columns>}}` — the shape
// every read door answers in, derived whole from the vocabulary.
export let bundleSchema = (vocab: Vocab) =>
  z.object({
    ...Object.fromEntries(
      vocab.all.map((name) => [name, compSchema(vocab, name).optional()]),
    ),
    // `entity` and `kind` are stated AFTER the vocabulary and win over it: the
    // spine is a declared component too, but its `eid` is the row key rather
    // than a column, and a read speaks the derived display kind beside it.
    kind: z.string().optional().describe(
      'the derived display kind — what the components make this entity',
    ),
    entity: z.object({
      eid: z.string(),
      num: z.number().nullable().optional(),
    }).passthrough(),
  }).passthrough()

// The fleet's own bundle, built once: mcpServer() may be constructed twice in
// one process (the /mcp mount and the stdio door) and the vocabulary is the
// same both times.
let fleetBundle: z.ZodTypeAny | undefined
export let bundle = () => fleetBundle ??= bundleSchema(fleetVocab())

// task_show answers one bundle plus the edges and comments around it.
export let showSchema = () =>
  z.object({
    refs: z.array(refSchema).optional(),
    backrefs: z.array(backrefSchema).optional(),
    comments: z.array(bundle()).optional(),
  }).passthrough()

// graph_apply: what the batch did. `changes` is the EFFECTIVE wire — every
// change the store actually wrote, including the ones apply() synthesized —
// and `aliases` maps each $alias the batch minted to its eid.
export let applySchema = z.object({
  submitted: z.number(),
  effective: z.number(),
  changes: z.array(
    z.object({
      eid: z.string(),
      name: z.string(),
      comp: z.record(z.unknown()).nullable(),
    }).passthrough(),
  ),
  aliases: z.record(z.string()).optional(),
}).passthrough()

// ui_state: where every client is looking. Three lists, each row keyed by the
// human id of the entity it reports on.
export let uiStateSchema = z.object({
  cursors: z.array(z.record(z.unknown())),
  cameras: z.array(z.record(z.unknown())),
  cards: z.array(z.record(z.unknown())),
}).passthrough()

// work_list: the bounded lane envelope (src/work.ts WorkCandidate), not graph
// rows — named down to the fields a caller routes on, open for the rest.
export let workSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    proposed: z.boolean(),
    decision: z.enum(['pending', 'approved', 'declined', 'none']),
    claim: z.string().nullable(),
    blocked: z.string().nullable(),
  }).passthrough(),
)

// code_run: the sandbox's answer. `result` is whatever the caller's JS
// returned, so it stays unknown; `batch` rides only on a dry run.
export let codeSchema = z.object({
  result: z.unknown(),
  logs: z.array(z.string()),
  status: z.string(),
  batch: z.array(z.record(z.unknown())).optional(),
}).passthrough()
