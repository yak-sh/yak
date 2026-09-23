// Tools a vocabulary declares. A `$defs` entry marked `tool: true` declares
// what the tool is called and what arguments it takes; the implementation
// lives in the module. This file joins the two: declarations from the
// documents, implementations from the module, one `Tool[]` out — so a
// package's declarations and its code each live where they belong, and neither
// is written twice.
//
//   let tools = loadTools([vocab], { session_list: (args, ctx) => ... })
//
// A declaration nothing implements throws at load time, rather than producing
// a tool that returns "not implemented" when it is called: the vocabulary is
// what a client lists, and a tool it lists has to work. (An app manifest is
// the other half of the same rule — there a template takes the place of the
// module, and workers/yak declared.ts runs it.)
//
// This package's own tool declarations are in ./vocab.json — the generic tier,
// `graph apply` and the rest — and `runs` below implements them, the same
// arrangement every other package uses. A tool is handed the call's own bundle
// (its arguments arrive on `ctx.args`, already parsed and validated by the
// runner) and returns bundles, which for the reads here are the entities they
// found. The two results that are not entities say so in their own way:
// `graph_schema` returns one `content{body}` entity holding the schema as JSON,
// and `graph_apply` returns the transaction it committed, which the runner
// commits as the caller. @yaks/mcp's `core` is what shapes these for one
// server.
//
// This module is NOT re-exported from mod.ts and never will be: reading a
// declaration means validating it, which means a JSON Schema validator, which
// has no business in a browser tab that only wants the graph. Import `@yaks/graph/tools` to get it.

import { toolsIn, toolsSaid } from '@yaks/vocab/tools'
import { extendMeta, type Keywords, type VocabDoc } from '@yaks/vocab'
import type { Bundle } from './bundle.ts'
import type { Tool, ToolCtx } from './plugin.ts'
import { type NamedTool, toolName } from './tool.ts'
import { graphDoc } from './vocab.ts'
import { Refused } from './admit.ts'
import { detached } from './storage.ts'
import { type Guide, proseOf, schemaOf } from './schema.ts'

/** The implementations a set of declarations needs. Keyed by the declaration's
 * own `name`, or by the name derived from its noun and verb for a module that
 * keys them that way — `noun_verb` for a tool that declared both, and the one
 * word itself for a tool that declared only a noun or only a verb. */
export type Runs<C = ToolCtx, R = Bundle[]> = Record<string, Tool<C, R>['run']>

export let loadTools = <C = ToolCtx, R = Bundle[]>(
  docs: VocabDoc | VocabDoc[],
  runs: Runs<C, R>,
): NamedTool<C, R>[] =>
  toolsIn(docs).map((decl) => {
    let name = decl.name ?? toolName(decl)
    let run = runs[name] ??
      runs[[decl.noun, decl.verb].filter(Boolean).join('_')]
    if (!run) {
      throw new Error(
        `tool '${name}' is declared and not implemented — give loadTools a ` +
          `run under '${name}', or stop declaring it`,
      )
    }
    return { ...decl, name, run }
  })

/**
 * Ranked full-text search, where the program that opened the graph has it.
 * Compose {@link https://jsr.io/@yaks/fts | @yaks/fts} into your storage and a
 * bare word in a query already filters inside `graph_query`; pass this as well
 * and ranked search gets a tool of its own.
 */
export type Search = (
  words: string,
  opts?: { limit?: number },
) => Bundle[] | Promise<Bundle[]>

/** What the generic tier's implementations need from the program that opened
 * the graph: the ranked search it may not have, and where a component is
 * documented at length. */
export type Seams = {
  /** the ranked search function; without it there is no `search`
   * implementation, and the declaration is not listed either (@yaks/mcp
   * `core`) */
  search?: Search
  /** where a component is documented at length, when this program has such a
   * page — `graph_schema` returns the address beside the properties */
  guide?: Guide
  /** the extension keyword vocabularies this graph's documents use, which
   * `graph_schema`'s answer carries and its output schema admits */
  keywords?: Keywords[]
}

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let num = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined
let strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x == 'string') : []

// The bundles `graph_apply` was handed, checked before anything is applied. The
// input schema is the vocabulary itself (@yaks/mcp `bundleSchema` at `write`),
// so a client knows every component, every writable property and every type
// before it writes one — this is the check the schema cannot make, the identity
// every bundle must carry.
let batch = (v: unknown): Bundle[] => {
  if (!Array.isArray(v)) throw new Refused('change must be an array of bundles')
  return v.map((b, i) => {
    let eid = b && typeof b == 'object' ? b.entity?.eid : undefined
    if (typeof eid != 'string' || !eid) {
      throw new Refused(
        `bundle ${i} needs an entity: {entity: {eid}} — an eid you mint, or ` +
          `'$name' to have the graph mint one`,
      )
    }
    return b
  })
}

// The entities, then everything pointing at them, each one whole and each one
// once. `.refs=<id>` is the query grammar's backlink union, so the incoming
// references cost one query, not one per reference property.
let gather = async (
  ctx: ToolCtx,
  said: string[],
  backrefs: boolean,
): Promise<Bundle[]> => {
  // What the caller typed, as the eids it names: an id that is an entity is
  // itself, and anything else is whatever a plugin declares it addresses — a name,
  // where @yaks/alias is composed in. Nothing composed, nothing to resolve.
  let at = await ctx.graph.address(said)
  let ids = said.map((id) => at.get(id) ?? id)
  let found = await detached(ctx.graph.storage).get(ids)
  let seen = new Map<string, Bundle>()
  for (let b of found) seen.set(b.entity.eid, b)
  if (backrefs) {
    for (let id of ids) {
      for (let b of await ctx.read(`.refs=${id}`)) {
        if (!seen.has(b.entity.eid)) seen.set(b.entity.eid, b)
      }
    }
  }
  return [...seen.values()]
}

/**
 * The implementations behind ./vocab.json — the generic tier, every one of
 * them taking bundles in and returning bundles out. `search` appears only
 * where the caller passed a search function, which leaves the tool unlisted
 * rather than listed and unable to run.
 *
 * There is no shorthand here for any particular domain — no `book_shelve`, no
 * `task_done`. A bundle already carries everything such a tool would carry,
 * and an agent that knows the bundle format can write anything the vocabulary
 * declares without a tool per component. Sugar belongs in a plugin, which contributes
 * its tools the same way it contributes components ({@link Tool}).
 */
export let runs = (seams: Seams = {}): Runs => {
  let find = seams.search
  return {
    // The tool does not write: the bundles it answers are the write, landed by
    // the runner signed as the caller, and the batch as applied is what comes
    // back. `check: true` makes the call a rehearsal, which the runner answers
    // with what a kept write would have returned (@yaks/tools).
    graph_apply: (_, ctx) => batch(ctx.args.change),
    // The one concession to typing by hand is the query line: `.status=shelved`
    // is the grammar @yaks/query owns, so this takes it as a string and the
    // optional `filters` list is joined onto it with `&`.
    graph_query: async (_, ctx) => {
      let line = [str(ctx.args.q), ...strings(ctx.args.filters)]
        .map((s) => s.trim()).filter(Boolean)
      let n = num(ctx.args.limit)
      if (n) line.push(`.limit=${n}`)
      if (!line.length) throw new Refused('graph_query needs a query line')
      return await ctx.read(line.join('&'))
    },
    graph_show: async (_, ctx) => {
      let ids = strings(ctx.args.ids)
      if (!ids.length) throw new Refused('graph_show needs at least one id')
      return await gather(ctx, ids, ctx.args.backrefs !== false)
    },
    graph_schema: (_, ctx) => {
      let v = ctx.graph.vocab
      let named = [
        ...(typeof ctx.args.component == 'string' ? [ctx.args.component] : []),
        ...strings(ctx.args.component),
      ]
      let kind = str(ctx.args.kind)
      for (let name of [...named, ...(kind ? [kind] : [])]) {
        if (v.comp(name)) continue
        throw new Refused(
          `no component '${name}' — call graph_schema with no arguments ` +
            `for the index of every word this graph knows`,
        )
      }
      if (kind && !v.comp(kind)!.kind) {
        throw new Refused(
          `'${kind}' is a component, not a kind — the kinds are ` +
            `${v.kinds.join(', ')}; ask for it as component instead`,
        )
      }
      let about = kind ? { kind } : { comps: named }
      return [{
        entity: { eid: '$said' },
        content: { body: proseOf(v, about, seams.guide) },
        output: { source: ctx.call, value: schemaOf(v, about) },
      }]
    },
    ...(find
      ? {
        search: async (_: Bundle[], ctx: ToolCtx) => {
          let words = str(ctx.args.words).trim()
          if (!words) throw new Refused('search needs words')
          return await find(words, { limit: num(ctx.args.limit) })
        },
      }
      : {}),
  }
}

// A schema without its `$schema` line. A tool's schemas are read as JSON
// Schema 2020-12 already, and a client whose validator defaults to an older
// draft refuses a schema that names 2020-12 before checking anything.
let undialected = (
  { $schema: _, ...rest }: Record<string, unknown>,
): Record<string, unknown> => rest

/**
 * The generic tier, declared and implemented: ./vocab.json's entries paired
 * with {@link runs}. A graph with no ranked search has no `search` tool at
 * all — the declaration is left unread rather than listed unable to run.
 *
 * The declarations are read rather than checked ({@link toolsSaid}), because
 * they are this package's own and its tests check them against the
 * meta-schema, so no program pays to check them again at load. Each transport
 * restates the arguments in
 * the form it accepts (@yaks/mcp `core`, which is also what shapes this tier
 * for one server).
 */
export let tier = (seams: Seams = {}): NamedTool[] => {
  let doing = runs(seams)
  return toolsSaid(graphDoc)
    .filter((decl) => !!doing[decl.name!])
    .map((decl) => ({
      ...decl,
      name: decl.name!,
      run: doing[decl.name!],
      // What `graph_schema` answers is a vocabulary document, so its shape is
      // the meta-schema, admitting the keywords this graph's documents use.
      // No declaration could state it: the keywords come from one graph, and
      // a declaration is written before there is a graph.
      ...(decl.name == 'graph_schema'
        ? { outputSchema: undialected(extendMeta(seams.keywords ?? [])) }
        : {}),
    }))
}

/** Every name the generic tier declares, whether or not a given graph lists
 * all of them. A transport that restates the tier in the form it accepts
 * (@yaks/mcp `core`) drops these from the tool list its host handed it, so
 * each of them is listed once rather than twice under one name. */
export let generic: string[] = toolsSaid(graphDoc).map((decl) =>
  decl.name ?? toolName(decl)
)
