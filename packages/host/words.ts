// Vocabulary assembly from already-imported facets, with no storage opened.
import type { NamedTool } from '@yaks/graph'
import { toolName } from '@yaks/graph/call'
import { tier } from '@yaks/graph/tools'
import { derived as callsDerived } from '@yaks/tools/vocab'
import { toolsIn } from '@yaks/vocab/tools'
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab/runtime'
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
  FacetName[]?,
][]

export let taking = async <F extends FacetName>(
  plugins: Configured[],
  name: F,
  load: Load,
): Promise<Taken<F>> =>
  (await Promise.all(
    plugins.filter(([, , , facets]) =>
      facets === undefined || facets.includes(name)
    ).map(async ([plugin, options, words, facets]) => {
      let mod = await load(plugin, name)
      if (!mod && name == 'vocab') selected([], words, plugin)
      return [mod, options, plugin, words, facets] as const
    }),
  )).filter((
    t,
  ): t is [
    Facets[F],
    Options,
    string,
    string[] | undefined,
    FacetName[] | undefined,
  ] => !!t[0])

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
  choices?: WeakMap<
    WordsOpts,
    {
      words?: Words
      own?: WeakMap<VocabDoc[], Words>
      sources?: { entries: Map<string, Words>; chars: number }
    }
  >
}
/** A concrete host may compose only the words it explicitly configured.
 * Keywords supplied here likewise replace the plugins' keyword registrations. */
export type WordsOpts = { implicit?: boolean; keywords?: Keywords[] }
let defaults: WordsOpts = {}
let worded: Worded = { next: new WeakMap() }
export let wordsOf = (
  vocabs: Taken<'vocab'>,
  own?: VocabDoc[],
  opts: WordsOpts = defaults,
): Words => {
  let at = vocabs.reduce((node, [v, , plugin, names]) => {
    let named = node.next.get(v)
    if (!named) node.next.set(v, named = new Map())
    let key = JSON.stringify([plugin, names && [...new Set(names)].sort()])
    let next = named.get(key)
    if (!next) named.set(key, next = { next: new WeakMap() })
    return next
  }, worded)
  let choices = at.choices ??= new WeakMap()
  let choice = choices.get(opts)
  if (!choice) choices.set(opts, choice = {})
  if (!own?.length) return choice.words ??= spoken(vocabs, [], opts)
  let held = choice.own ??= new WeakMap()
  let words = held.get(own)
  if (!words) {
    // Hosts often decode the same small set of graph-owned documents afresh.
    // Retain equivalent compilations across interleaved graphs, bounded by
    // both their count and the source text they keep.
    let source = JSON.stringify(own)
    let sources = choice.sources ??= { entries: new Map(), chars: 0 }
    words = sources.entries.get(source)
    if (words) {
      sources.entries.delete(source)
      sources.entries.set(source, words)
    } else {
      words = spoken(vocabs, own, opts)
      if (source.length <= 256 * 1024) {
        sources.entries.set(source, words)
        sources.chars += source.length
        while (sources.entries.size > 16 || sources.chars > 256 * 1024) {
          let first = sources.entries.keys().next().value!
          sources.entries.delete(first)
          sources.chars -= first.length
        }
      }
    }
    held.set(own, words)
  }
  return words
}

// The words, from the `./vocab` facets already imported.
let spoken = (
  vocabs: Taken<'vocab'>,
  own: VocabDoc[],
  opts: WordsOpts,
): Words => {
  // The components a tool call is recorded in belong to the host, not to
  // whichever plugin happened to declare them: what was asked of this host is
  // its own record. A plugin that already declares them — a harness, whose
  // transcripts are calls — keeps its own definitions, so only the components
  // nobody supplied are added.
  let docs: VocabDoc[] = vocabs.flatMap(([v, , plugin, names]) =>
    selected(v.docs ?? [], names, plugin).map((d) => ({
      ...d,
      package: plugin,
      description: v.description,
    }))
  )
  if (opts.implicit !== false) docs = docsOf(docs)
  let keywords = opts.keywords ??
    (opts.implicit === false
      ? vocabs.flatMap(([v]) => v.keywords ?? [])
      : understood(vocabs.flatMap(([v]) => v.keywords ?? [])))
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
