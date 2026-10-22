// Tools a vocabulary declares. A `$defs` entry marked `tool: true` declares
// what the tool is called and what arguments it takes; the implementation
// lives in the module. This file joins the two: declarations from the
// documents, implementations from the module, one `Tool[]` out — so a
// package's declarations and its code each live where they belong, and neither
// is written twice.
//
//   let tools = loadTools([vocab], { session_list: (call, graph) => ... })
//
// A declaration nothing implements throws when the implementations arrive —
// at load time, or on the first call for a host that fetches them then — never
// as a tool that answers "not implemented": the vocabulary is what a client
// lists, and a tool it lists has to work. (An app manifest is
// the other half of the same rule — there a template takes the place of the
// module, and workers/yak declared.ts runs it.)
//
// This package's own tool declarations are in ./vocab.json — the generic tier,
// `graph apply` and the rest — and `runs` below implements them, the same
// arrangement every other package uses. A tool is handed the call and the
// graph (the call's arguments are `argsOf(call)`, already validated by the
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

import {
  adopt,
  conjoin,
  directive,
  eq,
  map,
  parse,
  type Pred,
  present,
  type Query,
  stringify,
  words,
} from '@yaks/query/core'
import { toolsIn, toolsSaid } from '@yaks/vocab/tools'
import type { Keywords, VocabDoc } from '@yaks/vocab'
import { aggregate, reduced } from './aggregate.ts'
import { hit } from './hit.ts'
import { named } from './projection.ts'
import type { Bundle } from './bundle.ts'
import type { Graph } from './graph.ts'
import type { Tool } from './plugin.ts'
import { argsOf, type NamedTool, toolName } from './tool.ts'
import { declared, graphDoc } from './vocab.ts'
import { formed } from './admit.ts'
import { Refused } from './errors.ts'
import { type Guide, proseOf, schemaOf } from './schema.ts'

/** The implementations a set of declarations needs. Keyed by the declaration's
 * own `name`, or by the name derived from its noun and verb for a module that
 * keys them that way — `noun_verb` for a tool that declared both, and the one
 * word itself for a tool that declared only a noun or only a verb. */
export type Runs<R = Bundle[]> = Record<string, Tool<R>['run']>

/** The implementations, fetched the first time one of the tools is called: a
 * host imports a package's code only for a tool somebody calls (@yaks/cli
 * `compose`). A declaration nothing implements throws then, on that call. */
export type Later<R = Bundle[]> = () => Promise<Runs<R>>

export let loadTools = <R = Bundle[]>(
  docs: VocabDoc | VocabDoc[],
  runs: Runs<R> | Later<R>,
): NamedTool<R>[] => {
  if (typeof runs == 'function') {
    let joined: Promise<NamedTool<R>[]> | undefined
    let tools = () => joined ??= runs().then((said) => loadTools(docs, said))
    return toolsIn(docs).map((decl) => {
      let name = decl.name ?? toolName(decl)
      let run = async (call: Bundle, graph: Graph) =>
        (await tools()).find((t) => t.name == name)!.run(call, graph)
      return { ...decl, name, run }
    })
  }
  return toolsIn(docs).map((decl) => {
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
}

/**
 * Ranked search, where the program that opened the graph has it. The result
 * bundles carry a query-only `hit` with the title, kind, excerpt and source;
 * the tool answers the same compact shape over words and meaning.
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

/** How many rows a search answers when it asks for no window of its own: its
 * best, as the `search` tool's are. */
export let BEST = 20

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let num = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined
let strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x == 'string') : []

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
    graph_apply: (call, graph) => {
      let { q, bundles } = argsOf(call)
      if (q === undefined) {
        if (bundles === undefined) {
          throw new Refused('graph_apply needs q or bundles')
        }
        return formed(bundles)
      }
      if (bundles !== undefined) {
        throw new Refused('graph_apply takes q or bundles, not both')
      }
      try {
        let ast = parse(str(q))
        let first = ast.clauses[0]
        // A leading address is the sole shorthand around the shared grammar.
        // Leave every other clause to strict adoption, never a second parser.
        if (first?.kind == 'text') {
          ast = {
            ...ast,
            clauses: [eq('entity.eid', first.value), ...ast.clauses.slice(1)],
          }
        } else if (first?.kind == 'var' && first.value === undefined) {
          ast = {
            ...ast,
            clauses: [
              eq('entity.eid', '$' + first.name),
              ...ast.clauses.slice(1),
            ],
          }
        }
        let targets = 0
        map(ast, (clause) => {
          if (
            clause.kind == 'pred' && clause.path.join('.') == 'entity.eid'
          ) targets++
          return clause
        })
        if (targets != 1) {
          throw new Refused(
            'graph_apply needs exactly one entity.eid; use bundles for several entities',
          )
        }
        let patch = adopt(ast, graph.vocab, { strict: true })
        let eid = patch.entity?.eid
        if (typeof eid != 'string' || !eid) {
          throw new Refused('graph_apply needs a nonempty entity.eid')
        }
        if (!Object.keys(patch).some((name) => name != 'entity')) {
          throw new Refused(
            'graph_apply needs a component or property to write',
          )
        }
        // Addressing is the write door's job, just as for --bundles: names and
        // human ids must already exist; a fresh UUID or $name creates an entity.
        return formed([{ ...patch, entity: { eid } }])
      } catch (error) {
        if (error instanceof TypeError || error instanceof SyntaxError) {
          throw new Refused(error.message)
        }
        throw error
      }
    },
    // The one concession to typing by hand is the query line:
    // `.book.status=shelved` is the grammar @yaks/query owns, so this takes it as a string, and each
    // of the optional `filters` narrows the whole of it (`conjoin`). It stays a
    // line, because a graph may pass it on as one: the yaks.app reach reads its
    // riders off the text and asks each store over HTTP. A line that asks for
    // a reduction (`.count`, `.tally=`, `.distinct=`) asks about the selection,
    // not its members, and is answered as `/query` answers it: the value, said
    // the way graph_schema says its answer. A search with no window of its
    // own answers its best `BEST`: `mossvale` matched 13,065 entities, more
    // than one read may hold whole and more than anyone reads past the best.
    // A search that names no component answers its rows whole, each wearing
    // the `hit` the `search` tool answers, so a reader of the text reads a
    // line a row instead of every body, and graph_show reads one whole.
    graph_query: async (call, graph) => {
      let args = argsOf(call)
      let n = num(args.limit)
      let q = conjoin(
        str(args.q),
        ...strings(args.filters),
        n == null ? '' : `.limit=${n}`,
      )
      if (!q) throw new Refused('graph_query needs a query line')
      let ast = parse(q)
      let ask = unfiltered(ast)
      if (ask) throw new Refused(asksOnly(ast, ask))
      let op = aggregate(ast)
      if (!op) {
        let said = words(ast)
        let windowed = ast.clauses.some((c) => c.kind == 'limit')
        let rows = await graph.read(
          said.length && !windowed ? conjoin(q, `.limit=${BEST}`) : q,
        )
        if (!said.length || named(graph.vocab, ast)) return rows
        let line = hit(graph.vocab, said)
        return rows.map((b) => ({ ...b, hit: line(b) }))
      }
      let value = reduced(op, await graph.rows(q))
      return [{
        entity: { eid: '$said' },
        content: { body: JSON.stringify(value) },
        output: { source: call.entity.eid, value },
      }]
    },
    graph_show: async (call, graph) => {
      let args = argsOf(call)
      // The entities asked for, each one whole and each one once, and nothing
      // else: what points at them is a query of its own (`.refs=<id>`). The
      // ids arrive as the eids they name (@yaks/tools resolves every
      // declared reference).
      let ids = strings(args.ids)
      if (!ids.length) throw new Refused('graph_show needs at least one id')
      return await graph.get([...new Set(ids)])
    },
    graph_schema: (call, graph) => {
      let args = argsOf(call)
      let v = graph.vocab
      // A component's name is one word, so a string of several, however they
      // are set apart (`topic persona`, `topic, persona`), is those names.
      let named = strings([args.component].flat())
        .flatMap((s) => s.split(/[\s,]+/).filter(Boolean))
      let kind = str(args.kind)
      let unknown = [...named, ...(kind ? [kind] : [])]
        .filter((name) => !v.comp(name))
      if (unknown.length) {
        throw new Refused(
          `no component ${unknown.map((n) => `'${n}'`).join(', ')} — call ` +
            `graph_schema with no arguments for the index of every word ` +
            `this graph knows`,
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
        output: { source: call.entity.eid, value: schemaOf(v, about) },
      }]
    },
    ...(find
      ? {
        search: async (call: Bundle) => {
          let args = argsOf(call)
          let words = str(args.words).trim()
          if (!words) throw new Refused('search needs words')
          return await find(words, { limit: num(args.limit) })
        },
      }
      : {}),
  }
}

// The first component a line asks for (`?topic`) when nothing on it filters.
// `?comp` carries a component on the entities a filter selects, so alone it
// answers the newest entities of every kind, which a caller who wrote it never
// meant: a model new to the grammar reads `?topic` as "has topic". `.near`
// ranks the whole graph, so beside it nothing else need filter.
let unfiltered = (ast: Query): Pred | undefined => {
  let asks = ast.clauses.filter((c): c is Pred =>
    c.kind == 'pred' && c.op == '?'
  )
  let filters = ast.clauses.some((c) =>
    c.kind == 'near' || !directive(c) && !asks.includes(c as Pred)
  )
  return filters ? undefined : asks[0]
}

// The refusal of a line that only asks, with the line it probably meant: its
// first ask made the filter.
let asksOnly = (ast: Query, ask: Pred): string => {
  let name = ask.path.join('.')
  let asked = ast.clauses.filter((c) => c.kind == 'pred')
    .map((c) => `?${(c as Pred).path.join('.')}`).join(' ')
  let meant = stringify(map(ast, (c) => c === ask ? present(name) : c))
  return `${asked} filters nothing: ?${name} carries ${name} on the ` +
    `entities a filter selects, so alone it answers the newest entities of ` +
    `every kind — to select the entities that have ${name}, write ${meant}`
}

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
  return declared({ keywords: seams.keywords, search: !!seams.search })
    .map((decl) => ({
      ...decl,
      run: doing[decl.name],
    }))
}

/** Every name the generic tier declares, whether or not a given graph lists
 * all of them. A transport that restates the tier in the form it accepts
 * (@yaks/mcp `core`) drops these from the tool list its host handed it, so
 * each of them is listed once rather than twice under one name. */
export let generic: string[] = toolsSaid(graphDoc).map((decl) =>
  decl.name ?? toolName(decl)
)
