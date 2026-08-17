// Shell tab-completion for a partial `task` line: the candidates that could
// come next, drawn from the SAME declaration table help and validation read
// (manual.ts + commands.ts), so what completes is exactly what runs. One list,
// another door (D-13859 stage 5). Distinct from complete.ts, which is the LLM
// one-shot; this is the CLI's own tab hook.
//
// Pure but for `ids`: a positional whose Kind is an entity reference completes
// to real ids, which only the graph knows. cli.ts passes a snapshot-backed
// thunk; help and validate never do, so they — and `--help` against a down
// server — stay offline. The thunk is called at most once, lazily.

import { cliVerbs, manuals, route } from './manual.ts'
import { commands } from './commands.ts'
import { plurals } from './types.ts'
import type { Arg, Decl, Opt } from './verb.ts'

let starts = (pre: string) => (s: string) => s.startsWith(pre)

// Every first word a bare `task <TAB>` accepts: the top-level verbs, the plural
// kinds that ARE listing verbs (`task projects`), and every `:` command.
let heads = (): string[] => [
  ...Object.keys(manuals).filter((n) =>
    !n.includes(' ') && !['subject', ':'].includes(n) && !manuals[n].deprecated
  ),
  ...[...plurals].filter((p) => !cliVerbs.has(p)),
  ...Object.keys(commands).map((n) => `:${n}`),
]

// The subcommands one word deep under a parent verb (`mail send`, `role stop`).
let subverbs = (parent: string): string[] =>
  Object.keys(manuals)
    .filter((n) =>
      n.startsWith(`${parent} `) && !n.slice(parent.length + 1).includes(' ')
    )
    .map((n) => n.slice(parent.length + 1))

// A Kind's finite candidate set, if it has one — enums and provider tables
// carry `of`; an entity reference borrows the graph's ids through `at`.
let candidates = (
  kind: Arg['kind'] | Opt['kind'],
  at: () => string[],
): string[] => (kind?.of ? kind.of() : kind?.id ? at() : [])

// The positionals already settled among a verb's post-name words — options and
// their separate values don't count, so the caller's cursor lands on the right
// slot. (A separate-value option like `-n 5` is rare beside a positional; the
// value is skipped by name where it can be.)
let filled = (verb: Decl, args: string[]): number => {
  let opts = verb.opts ?? []
  let n = 0
  for (let i = 0; i < args.length; i++) {
    let a = args[i]
    if (a == '--') break
    if (a.startsWith('-')) {
      let opt = opts.find((o) => a == o.name || a.startsWith(`${o.name}=`))
      // `-n 5`: the bare flag eats the next word as its value.
      if (opt?.kind && opt.separate && a == opt.name) i++
      continue
    }
    n++
  }
  return n
}

// The candidates for `words` — the args after `task`, the last being the
// (possibly empty) word under the cursor.
export let complete = (
  words: string[],
  ids: () => string[] = () => [],
): string[] => {
  let cur = words.at(-1) ?? ''
  let prior = words.slice(0, -1)

  // Word 0: the heads.
  if (!prior.length) return heads().filter(starts(cur))

  let sel = route(prior[0], prior.slice(1))
  if (!sel) return []
  let verb = sel.manual
  let opts = verb.opts ?? []

  // `--model=<value>`: the option's own value set.
  let eq = cur.match(/^(--[\w-]+)=(.*)$/s)
  if (eq) {
    let opt = opts.find((o) => o.name == eq![1])
    return candidates(opt?.kind, ids)
      .filter(starts(eq[2]))
      .map((v) => `${eq![1]}=${v}`)
  }

  // A bare option name: those not already given.
  if (cur.startsWith('-')) {
    let given = new Set(
      sel.args.filter((a) => a.startsWith('-')).map((a) => a.split('=')[0]),
    )
    return opts.map((o) => o.name).filter((n) =>
      !given.has(n) && n.startsWith(cur)
    )
  }

  // A separate-value option awaiting its value (`--effort <TAB>`, `-n <TAB>`).
  let last = sel.args.at(-1)
  let awaiting = last &&
    opts.find((o) => o.name == last && o.separate && o.kind)
  if (awaiting) return candidates(awaiting.kind, ids).filter(starts(cur))

  // Otherwise: the subcommands under this verb, plus the next positional slot.
  let slot = (verb.args ?? [])[filled(verb, sel.args)] ??
    (verb.args?.at(-1)?.rest ? verb.args.at(-1) : undefined)
  return [
    ...subverbs(sel.name),
    ...(slot ? candidates(slot.kind, ids) : []),
  ].filter(starts(cur))
}
