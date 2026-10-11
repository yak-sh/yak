// Vocabulary assembly from already-imported facets, with no storage opened.
import { type NamedTool, toolName } from '@yaks/graph'
import { tier } from '@yaks/graph/tools'
import { derived as callsDerived } from '@yaks/tools/vocab'
import { toolsIn } from '@yaks/vocab/tools'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab/runtime'
import { fields as searched } from '@yaks/fts/fields'
import type { Backings, Derived } from '@yaks/sql'
import type { Configured, Options } from './config.ts'
import type { FacetName, Facets, Load, VocabFacet } from './facets.ts'
import { understood } from './keywords.ts'
import { beneath, docsOf, selected } from './documents.ts'
// One facet of every plugin a config names, each beside the options it was
// named with, the package it came from and its chosen words: what a process
// runs is one plugin's module handed one plugin's config. The package comes third, because a duty's
// lease is named after the package that owns the work — the lease `@yaks/wake`
// holds is the one every process reaching for that timer reaches for.
export type Taken<F extends FacetName> = [
  Facets[F],
  Options,
  string,
  string[]?,
][]

export let taking = async <F extends FacetName>(
  plugins: Configured[],
  name: F,
  load: Load,
): Promise<Taken<F>> =>
  (await Promise.all(
    plugins.map(async ([plugin, options, words]) => {
      let mod = await load(plugin, name)
      if (!mod && name == 'vocab') selected([], words, plugin)
      return [mod, options, plugin, words] as const
    }),
  )).filter((t): t is [Facets[F], Options, string, string[] | undefined] =>
    !!t[0]
  )

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
type Worded = {
  next: WeakMap<VocabFacet, Map<string, Worded>>
  words?: Words
  own?: WeakMap<VocabDoc[], Words>
  recent?: { source: string; words: Words }
}
let worded: Worded = { next: new WeakMap() }
export let wordsOf = (vocabs: Taken<'vocab'>, own?: VocabDoc[]): Words => {
  let at = vocabs.reduce((node, [v, , plugin, names]) => {
    let named = node.next.get(v)
    if (!named) node.next.set(v, named = new Map())
    let key = JSON.stringify([plugin, names && [...new Set(names)].sort()])
    let next = named.get(key)
    if (!next) named.set(key, next = { next: new WeakMap() })
    return next
  }, worded)
  if (!own?.length) return at.words ??= spoken(vocabs)
  let held = at.own ??= new WeakMap()
  let words = held.get(own)
  if (!words) {
    // Graph-owned documents are JSON data, often decoded afresh by a host.
    // Keep one equivalent compilation beside the identity cache, so repeated
    // loads share the vocabulary without retaining every document ever seen.
    let source = JSON.stringify(own)
    words = at.recent?.source == source ? at.recent.words : spoken(vocabs, own)
    at.recent = { source, words }
    held.set(own, words)
  }
  return words
}

// The words, from the `./vocab` facets already imported.
let spoken = (vocabs: Taken<'vocab'>, own: VocabDoc[] = []): Words => {
  // The components a tool call is recorded in belong to the host, not to
  // whichever plugin happened to declare them: what was asked of this host is
  // its own record. A plugin that already declares them — a harness, whose
  // transcripts are calls — keeps its own definitions, so only the components
  // nobody supplied are added.
  let docs = docsOf(
    vocabs.flatMap(([v, , plugin, names]) =>
      selected(v.docs ?? [], names, plugin).map((d) => ({
        ...d,
        package: plugin,
        description: v.description,
      }))
    ),
  )
  let keywords = understood(vocabs.flatMap(([v]) => v.keywords ?? []))
  if (own.length) {
    docs = [...beneath(docs, own), ...own]
  }
  let vocab = loadVocab(docs, keywords)
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
