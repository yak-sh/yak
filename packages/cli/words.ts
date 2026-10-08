// What a config's plugins declare, read without opening anything: each one's
// `./vocab`, the vocabulary those documents load into, and the tools they
// declare. A command line lists its subcommands from these words
// (./subcommands.ts), and a graph is built over them (./host.ts `compose`).
// This module imports none of what opens a graph — no database, rule or
// effect — so a usage page, a help page or a mistyped word costs a command
// the plugins' declarations and nothing more.

import { type NamedTool, toolName } from '@yaks/graph'
import { tier } from '@yaks/graph/tools'
import { description as toolsAbout, toolsDoc } from '@yaks/tools/vocab'
import { derived as callsDerived } from '@yaks/tools/vocab'
import { toolsIn } from '@yaks/vocab/tools'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { docs as machineDocs } from '@yaks/machine/vocab'
import { gitDoc } from '@yaks/git/vocab'
import { fields as searched } from '@yaks/fts'
import type { Backings, Derived } from '@yaks/sql'
import {
  type Config,
  given,
  type Options,
  subpath,
  subpaths,
  used,
} from './config.ts'
import { understood } from './keywords.ts'
import type { FacetName, Facets, Load, VocabFacet } from './host.ts'

/** The default {@link Load}: {@link subpath}. */
export let facet: Load = Object.assign(
  <F extends FacetName>(plugin: string, name: F) =>
    subpath<Facets[F]>(plugin, name),
  { together: subpaths },
)

// The plugins' declarations, plus the components a tool call is recorded in
// where no plugin declared them. Declaring one component twice is an error
// (@yaks/vocab), and rightly — two definitions of one component is not
// something to guess about — so what is added here is only the difference,
// never a second copy.
let said = (docs: VocabDoc[]): VocabDoc[] => {
  let supplied = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  // Hosts lend machines; their durable records and commit references are host words,
  // even when no plugin separately contributes these vocabulary facets.
  let intrinsic = [...machineDocs, gitDoc].map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).filter(([name]) => !supplied.has(name)),
    ),
  }))
  docs = [...intrinsic.filter((doc) => Object.keys(doc.$defs).length), ...docs]
  let taken = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  let $defs = Object.fromEntries(
    Object.entries(toolsDoc.$defs ?? {}).filter(([name]) => !taken.has(name)),
  )
  return Object.keys($defs).length
    ? [{
      title: 'invocation',
      package: '@yaks/tools',
      description: toolsAbout,
      $defs,
    }, ...docs]
    : docs
}

// One facet of every plugin a config names, each beside the options it was
// named with and the package it came from: what a process runs is one plugin's
// module handed one plugin's config. The package comes third, because a duty's
// lease is named after the package that owns the work — the lease `@yaks/wake`
// holds is the one every process reaching for that timer reaches for.
export type Taken<F extends FacetName> = [Facets[F], Options, string][]

export let taking = async <F extends FacetName>(
  plugins: [string, Options][],
  name: F,
  load: Load,
): Promise<Taken<F>> =>
  (await Promise.all(
    plugins.map(async ([plugin, options]) =>
      [await load(plugin, name), options, plugin] as const
    ),
  )).filter((t): t is [Facets[F], Options, string] => !!t[0])

/** What a config's plugins declare, read without opening anything: their
 * vocabulary documents (each written with the package that brought it), the
 * vocabulary they load into, and the tools they declare. What a command line
 * lists, and what a graph is then built over. */
export type Words = {
  docs: VocabDoc[]
  vocab: Vocab
  /** the properties the store computes rather than stores */
  derived: Derived
  /** the rows the computed components are read from */
  backed: Backings
  /** the tools the graph these words describe offers, declared and not
   * implemented: the generic tier where the vocabulary gives it one, then every
   * plugin's */
  tools: () => Declared[]
}

/** A tool as declared, without the code behind it. */
export type Declared = Omit<NamedTool, 'run'>

// The words of these facets, made once while every facet lives. A vocabulary
// is a value nobody changes once it is loaded, so each graph a process opens
// over the same plugins shares one, and with it all that is kept per
// vocabulary: a store's install plan, a read's rendered statements.
type Worded = { next: WeakMap<VocabFacet, Map<string, Worded>>; words?: Words }
let worded: Worded = { next: new WeakMap() }
export let wordsOf = (vocabs: Taken<'vocab'>): Words => {
  let at = vocabs.reduce((node, [v, , plugin]) => {
    let named = node.next.get(v)
    if (!named) node.next.set(v, named = new Map())
    let next = named.get(plugin)
    if (!next) named.set(plugin, next = { next: new WeakMap() })
    return next
  }, worded)
  return at.words ??= spoken(vocabs)
}

// The words, from the `./vocab` facets already imported.
let spoken = (vocabs: Taken<'vocab'>): Words => {
  // The components a tool call is recorded in belong to the host, not to
  // whichever plugin happened to declare them: what was asked of this host is
  // its own record. A plugin that already declares them — a harness, whose
  // transcripts are calls — keeps its own definitions, so only the components
  // nobody supplied are added.
  let docs = said(
    vocabs.flatMap(([v, , plugin]) =>
      (v.docs ?? []).map((d) => ({
        ...d,
        package: plugin,
        description: v.description,
      }))
    ),
  )
  let vocab = loadVocab(
    docs,
    understood(vocabs.flatMap(([v]) => v.keywords ?? [])),
  )
  return {
    docs,
    vocab,
    derived: Object.assign(
      {},
      callsDerived(vocab),
      ...vocabs.map(([v]) => v.derived?.(vocab)),
    ),
    backed: Object.assign({}, ...vocabs.map(([v]) => v.backed?.(vocab))),
    // The generic tier lists `search` only where a property is indexed, so its
    // declarations are read off the tier the graph would build. Read on asking,
    // since checking every declaration costs what a graph opened to answer one
    // query should not pay twice.
    tools: () => [
      ...tier({
        keywords: vocab.keywords,
        ...(searched(vocab).length ? { search: () => [] } : {}),
      }).map(({ run: _, ...decl }) => decl),
      ...toolsIn(docs).map((decl) => ({
        ...decl,
        name: decl.name ?? toolName(decl),
      })),
    ],
  }
}

/** The words a config's plugins declare: each one's `./vocab`, and nothing
 * else — no database opened, no rule or tool imported. */
export let words = async (
  config: Config,
  load: Load = facet,
): Promise<Words> => {
  let plugins = (config.plugins ?? []).map((plug): [string, Options] => [
    used(plug),
    given(plug),
  ])
  await load.together?.(plugins.map(([p]) => [p, 'vocab'] as const))
  return wordsOf(await taking(plugins, 'vocab', load))
}
