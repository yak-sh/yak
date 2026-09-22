// Tab completion: what could come next on the command line, read off the same
// schema that runs it.
//
// Nothing here declares anything a second time. The subcommand names are the
// tools' nouns and verbs, the options are their input schemas' properties, and
// what a value may be is whatever the property declares about itself — an
// `enum` offers its members, a boolean offers true and false, `examples` offer
// themselves. The two that need the graph — `ref`, which names a component,
// and `search`, which marks full-text indexed text — are delegated to the
// caller, because a command-line client has no graph and should not grow one.
//
//   complete(tools, 'session li')        → ['list']
//   complete(tools, 'session list --')   → ['--all', '--limit', '--scope']
//   complete(tools, 'session list --status ') → ['done', 'open']
//
// A shell's completion hook passes its words; the harness's `:` prompt passes
// the whole line. Both are the same question, so both go through this one
// function.

import { commandOf, type Prop, type Schema, typeOf } from './tool.ts'
import { type Grammar, saidIn } from './args.ts'
import { commandFor } from './run.ts'

/** The two answers only a graph can give. Left out, a `ref` or a full-text
 * argument simply offers nothing, which is all a client with no connection
 * knows. */
export type Lookup = {
  /** the entities carrying `comp`, as the ids a person would type */
  ids?: (comp: string, prefix: string) => string[] | Promise<string[]>
  /** what the full-text index finds for a partial word */
  hits?: (prefix: string) => string[] | Promise<string[]>
}

// Split the line into the words completion is about: the last one is the word
// being typed, empty where the line ended in a space. An argv array (a shell
// hook's COMP_WORDS) is already in that form.
let wordsIn = (line: string | readonly string[]): string[] =>
  Array.isArray(line) ? [...line] : [
    ...(line as string).split(/\s+/).filter(Boolean),
    .../\s$/.test(line as string) || !(line as string) ? [''] : [],
  ]

let props = (t: Grammar): Record<string, Prop> =>
  ((t.inputSchema ?? {}) as Schema).properties ?? {}

// Every word a tool answers to as its first: a two-word tool answers to both
// of its words, because the two may be typed in either order.
let firsts = (tools: readonly Grammar[]): string[] =>
  tools.flatMap((t) => t.noun && t.verb ? [t.noun, t.verb] : [commandOf(t)])

// The other word of a pair, given one of them.
let seconds = (tools: readonly Grammar[], said: string): string[] =>
  tools.flatMap((t) =>
    !t.noun || !t.verb
      ? []
      : t.noun == said
      ? [t.verb]
      : t.verb == said
      ? [t.noun]
      : []
  )

// What one argument's value may be. Everything but the last two sources is in
// the schema itself.
let values = async (
  p: Prop | undefined,
  partial: string,
  look: Lookup,
): Promise<string[]> => {
  if (!p) return []
  if (p.enum) return p.enum.map(String)
  if (typeOf(p) == 'boolean') return ['true', 'false']
  let said = (p.examples ?? []).map(String)
  if (p.ref && look.ids) said.push(...await look.ids(p.ref, partial))
  if (p.search && look.hits) said.push(...await look.hits(partial))
  return said
}

// Which property the word being typed belongs to: the one the option before it
// named, or the next positional argument nothing has filled yet. A bare
// `--name` claims the next word whatever its type, because that is what the
// parser does with it (args.ts `saidIn`) — which is also why the positional
// arguments are counted by asking that same parser rather than by counting
// words without a dash.
let awaiting = (t: Grammar, args: readonly string[]): string | undefined => {
  let last = args.at(-1)
  if (last?.startsWith('--') && !last.includes('=')) return last.slice(2)
  return t.options?.positional?.[saidIn([...args]).words.length]
}

let kept = (said: string[], partial: string): string[] =>
  [...new Set(said)].filter((w) => w.startsWith(partial)).sort()

/**
 * What could come next, given the tools and the line so far. Each result is a
 * whole word, never the remaining characters — a shell hook and the harness's
 * `:` prompt both replace the word being typed.
 */
export let complete = async (
  tools: readonly Grammar[],
  line: string | readonly string[],
  look: Lookup = {},
): Promise<string[]> => {
  let words = wordsIn(line)
  let partial = words.at(-1) ?? ''
  let head = words.slice(0, -1)
  if (!head.length) return kept(firsts(tools), partial)
  let found = commandFor(tools, head)
  // One word in and no tool matched: it must be half of a two-word pair, and
  // what may follow it is the other half.
  if (!found) {
    return head.length == 1 ? kept(seconds(tools, head[0]), partial) : []
  }
  let t = found.verb
  let names = Object.keys(props(t))
  if (partial.startsWith('--')) {
    let [name, ...rest] = partial.slice(2).split('=')
    // `--name=` introduces a value, in the one form that accepts a value
    // beginning with a dash.
    if (rest.length) {
      let said = await values(props(t)[name], rest.join('='), look)
      return kept(said.map((v) => `--${name}=${v}`), partial)
    }
    let given = new Set(
      found.args.filter((w) => w.startsWith('--')).map((w) =>
        w.slice(2).split('=')[0]
      ),
    )
    return kept(
      names.filter((n) => !given.has(n)).map((n) => `--${n}`),
      partial,
    )
  }
  let name = awaiting(t, found.args)
  return kept(await values(props(t)[name ?? ''], partial, look), partial)
}
