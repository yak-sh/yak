// An app's OWN commands (T-32685, T-34541, T-38021): the `$defs` entries of an
// app's `vocab.json` marked `"tool": true`, the same form a package declares
// its tools in (@yaks/vocab `toolsSaid`, D-37544). app_deploy reads them beside
// the components and keeps them in that app's store (graph.ts `/tools`).
// Everyone who can reach the app reads them with the platform's `commands`
// tool and runs one with `command` — they are not MCP tools themselves,
// because that list is snapshotted by a directory and must be the same for
// everybody (workers/yak/declared.ts). One entry is a sentence, its arguments,
// and one act:
//
//   { "$defs": {
//       "log_run": {
//         "tool": true,
//         "description": "Log a run for the club leaderboard",
//         "input": { "who": { "type": "string" },
//                    "miles": { "type": "number" } },
//         "required": ["miles"],
//         "apply": { "entity": { "eid": "$run" },
//                    "run": { "who": "$who", "miles": "$miles" } } },
//       "leaderboard": {
//         "tool": true,
//         "description": "This month's runs",
//         "input": { "since": { "type": "string" } },
//         "query": ".run&.created.at>=$since" } } }
//
// `input` is one JSON Schema per argument and `required` names the ones a
// caller must send, as a package writes them. The act is what an app adds: a
// TEMPLATE over the app's own store. `apply` is the wire's entity bundle (or a
// list of them) and `query` is a filter line, and both are written in the ONE
// variable language the wire and the query grammar already speak. `$name` is a
// variable: BOUND by an argument of that name, it is that argument's value,
// typed by its schema; left unbound, it is what it has always been — an alias
// the store mints an entity at, so the same `$run` names the row in the bundle
// that made it. A `$name` that is neither an argument nor an entity this
// template writes is refused at deploy, because a tool that cannot be filled
// is one an agent calls once and gives up on. `$$` is a literal dollar sign.
//
// An argument a caller left out takes its variable with it: the key holding
// it is not written, and the `&`-clause naming it drops out of the filter
// line.
//
// An entry may also name a `view`: a page in the app's own files that the
// person's agent renders the answer in (T-32687), served at the MCP door as
// `ui://<space>/<app>/<file>` and named beside the command in what `commands`
// answers. The app writes that page the way it writes any other.
//
// Nothing here reaches the store: filling a template makes the same body a
// page's own `apply` and `query` send, and the call goes through the app's
// ordinary doors with the caller's identity and the app's access rule
// (workers/yak/declared.ts). So a tool can do exactly what the person
// calling it could do on the page, and never more.
import { argsOf, type Bundle, type Graph, type Tool } from '@yaks/graph'
import { CallError } from '@yaks/tools'

/** One argument's JSON Schema. */
export type Arg = Record<string, unknown>

// One declared tool, as its store keeps it. `apply` and `query` are the two
// acts; an entry names exactly one.
//
// `drop` is the one field a manifest cannot spell (see KEYS): it belongs to the
// tools a KIND is worth (workers/yak/kinds.ts), whose templates nobody wrote.
// It names the components that GO when the caller named none of their
// columns, since an empty component is a bare write and a bare `alias` is half
// a sentence, while an empty `recipe` is still what makes the row a recipe.
export type ToolDef = {
  description: string
  input: Record<string, Arg>
  required?: string[]
  drop?: string[]
  apply?: unknown
  query?: string
  view?: string
}

export type Tools = Record<string, ToolDef>

export let TOOLS_EXAMPLE = '{"$defs": {"log_run": {"tool": true, ' +
  '"description": "Log a run", "input": {"miles": {"type": "number"}}, ' +
  '"required": ["miles"], ' +
  '"apply": {"entity": {"eid": "$run"}, "run": {"miles": "$miles"}}}}}'

// The keys an entry may carry. Unknown ones are refused rather than ignored,
// so a misspelling is a sentence at deploy and not a tool that quietly does
// half of what was meant.
let KEYS = [
  'tool',
  'description',
  'input',
  'required',
  'apply',
  'query',
  'view',
]

// A `view` names a page in the app's OWN files (T-32687) — a relative path
// under the app's root, which the MCP door serves as `ui://<space>/<app>/
// <file>` for the host to render the answer in. HTML because that is the one
// type the MCP Apps spec renders; relative because the app's files are the
// only place a view may come from, and a path that climbs out of them would
// be a door onto somebody else's app.
let VIEW = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+\.html$/

// A command's name and an input's name: the same shape a tool name takes, so
// a command reads as a verb wherever it is said — `command` takes it whole,
// beside the app it belongs to.
let NAME = /^[a-z][a-z0-9_]{0,39}$/

// A variable, and the whole of a string that is nothing but one — the
// difference between a value passed through with its type and a value spliced
// into text. `$$` is a literal dollar and never a variable.
let VAR = /\$\$|\$([a-z][a-z0-9_]*)/g
let ONLY = /^\$([a-z][a-z0-9_]*)$/

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// The form before this one: `{{arg}}` was a hole where `$arg` is now a
// variable. A deploy that still writes one is refused, below, in the sentence
// that says what to write instead.
let HOLE = /\{\{[a-z][a-z0-9_]*\}\}/

// The wire's own keys beside the components: what an entity bundle may say
// that is not a component name (@yaks/graph `Bundle`).
let WIRE = ['entity', 'edges', 'tombstone', 'was']

// Every variable in a template, wherever the strings are.
let vars = (v: unknown, found: Set<string> = new Set()): Set<string> => {
  if (typeof v == 'string') {
    for (let m of v.matchAll(VAR)) if (m[1]) found.add(m[1])
  } else if (Array.isArray(v)) { for (let one of v) vars(one, found) }
  else if (object(v)) { for (let one of Object.values(v)) vars(one, found) }
  return found
}

// The variables this template MINTS: every `$name` standing alone as an
// entity's eid. Those are the aliases the store gives real ids to, so a
// `$name` pointing at one is a join and not a missing argument.
let minted = (v: unknown, found: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(v)) { for (let one of v) minted(one, found) }
  else if (object(v)) {
    let eid = object(v.entity) ? v.entity.eid : undefined
    let only = typeof eid == 'string' ? ONLY.exec(eid) : null
    if (only) found.add(only[1])
    for (let one of Object.values(v)) minted(one, found)
  }
  return found
}

// The components an `apply` template names, so a deploy can say which of them
// nobody declared. A bundle is an object (or a list of them) whose keys are
// the wire's own words and component names.
let named = (v: unknown, found: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(v)) { for (let one of v) named(one, found) }
  else if (object(v)) {
    for (let key of Object.keys(v)) if (!WIRE.includes(key)) found.add(key)
  }
  return found
}

// The tool entries of a manifest: every `$defs` entry marked `"tool": true`.
// The rest of the document is its components (vocab.ts `appDoc`), and neither
// reading has to know about the other.
let entriesOf = (held: unknown): [string, Arg][] =>
  object(held) && object(held.$defs)
    ? Object.entries(held.$defs).filter((e): e is [string, Arg] =>
      object(e[1]) && e[1].tool === true
    )
    : []

// The manifest as written, its tools checked whole: every problem in one
// sentence, the way the components are refused (T-32628), because an agent
// that fixes one problem per deploy stops after the second. `words` are the
// components the app's store knows, which are the only ones a template may
// write. `file` is what the sentence calls the manifest.
export let parseTools = (
  source: unknown,
  words: string[] = [],
  file = 'vocab.json',
): Tools => {
  if (typeof source == 'string') {
    if (!source.trim()) return {}
    // JSON, and only JSON — the YAML door is not in this module's graph: a
    // caller holding a `.yml` reads it first (tools.ts `released`).
    try {
      source = JSON.parse(source)
    } catch {
      throw new CallError('arguments', `${file} is not JSON — ${TOOLS_EXAMPLE}`)
    }
  }
  let wrong: string[] = []
  let out: Tools = {}
  for (let [name, entry] of entriesOf(source)) {
    if (!NAME.test(name)) {
      wrong.push(`${JSON.stringify(name)} is not a tool name (a-z, 0-9, _)`)
      continue
    }
    let alien = Object.keys(entry).filter((k) => !KEYS.includes(k))
    if (alien.length) {
      wrong.push(
        `${name}: ${alien.join(', ')} — a tool says ${KEYS.join(', ')}`,
      )
    }
    if (typeof entry.description != 'string' || !entry.description) {
      wrong.push(`${name}.description says what the tool does, in a sentence`)
    }
    let input: Record<string, Arg> = {}
    if (entry.input != null) {
      if (!object(entry.input)) {
        wrong.push(
          `${name}.input is an object of arguments — ${TOOLS_EXAMPLE}`,
        )
      } else {
        for (let [arg, schema] of Object.entries(entry.input)) {
          if (!NAME.test(arg)) {
            wrong.push(
              `${name}.input: ${JSON.stringify(arg)} is not an ` +
                'argument name (a-z, 0-9, _)',
            )
          } else if (!object(schema)) {
            wrong.push(
              `${name}.input.${arg} is ${JSON.stringify(schema)} — an ` +
                'argument is a JSON Schema, like {"type": "number"}',
            )
          } else input[arg] = schema
        }
      }
    }
    let required: string[] = []
    if (entry.required != null) {
      if (
        !Array.isArray(entry.required) ||
        !entry.required.every((r) => typeof r == 'string')
      ) {
        wrong.push(`${name}.required is a list of its input's names`)
      } else {
        for (let arg of entry.required as string[]) {
          if (arg in input) required.push(arg)
          else wrong.push(`${name}.required: ${arg} is no input of ${name}`)
        }
      }
    }
    if (HOLE.test(JSON.stringify(entry.apply ?? entry.query ?? ''))) {
      wrong.push(
        `${name}: {{arg}} is not a hole any more — write $arg, the same ` +
          'variable the wire and the query grammar already speak',
      )
    }
    let acts = ['apply', 'query'].filter((k) => entry[k] != null)
    if (acts.length != 1) {
      wrong.push(
        `${name} does one thing: apply (a bundle to write) or query (a ` +
          'filter line to read)',
      )
    }
    if (entry.view != null) {
      if (typeof entry.view != 'string' || !VIEW.test(entry.view)) {
        wrong.push(
          `${name}.view is a page in this app's files, like ` +
            '"leaderboard.html"',
        )
      }
    }
    if (entry.query != null && typeof entry.query != 'string') {
      wrong.push(`${name}.query is a filter line, like ".run"`)
    }
    if (
      entry.apply != null && !object(entry.apply) && !Array.isArray(entry.apply)
    ) {
      wrong.push(`${name}.apply is an entity bundle, or a list of them`)
    }
    // A variable that binds to nothing can never be filled, and a component
    // nobody declared can never be written — both are the deploy's to catch,
    // since the alternative is an agent calling the tool and reading `unknown
    // component` from a store it cannot see. A `$name` an entity in this same
    // template is minted at is neither: it is the join it looks like.
    let mints = entry.apply == null ? new Set<string>() : minted(entry.apply)
    for (let held of vars(entry.apply ?? entry.query)) {
      if (held in input || mints.has(held)) continue
      wrong.push(
        `${name}: $${held} names no input and no entity here — declare it ` +
          `in ${name}.input`,
      )
    }
    for (let comp of named(entry.apply)) {
      if (!words.includes(comp)) {
        wrong.push(
          `${name}.apply: ${comp} is not a component — declare it in ` +
            `${file}, or use one the platform already says`,
        )
      }
    }
    out[name] = {
      description: String(entry.description ?? ''),
      input,
      ...(required.length ? { required } : {}),
      ...(entry.apply != null ? { apply: entry.apply } : {}),
      ...(typeof entry.query == 'string' ? { query: entry.query } : {}),
      ...(typeof entry.view == 'string' && VIEW.test(entry.view)
        ? { view: entry.view }
        : {}),
    }
  }
  if (wrong.length) {
    throw new CallError('arguments', `${file}: ${wrong.join('; ')}`)
  }
  return out
}

// The pages a manifest's views name, read straight off the source so a deploy
// can check them against the app's own files before anything is planted. A
// manifest that will not parse yields none: {@link parseTools} says why.
export let viewsOf = (source: unknown): string[] => {
  let seen = new Set<string>()
  try {
    // A manifest as written is a string here only when it is JSON — a `.yml`
    // is read by whoever holds it and handed on as the value (see parseTools).
    let held = typeof source == 'string' ? JSON.parse(source) : source
    for (let [, entry] of entriesOf(held)) {
      if (typeof entry.view == 'string') seen.add(entry.view)
    }
  } catch { /* parseTools says why */ }
  return [...seen]
}

// The arguments a caller must send; every other one may be left out.
let needed = (tool: ToolDef) => tool.required ?? []

// The tool's arguments as one JSON Schema object, which is what a host shows
// the model and what a store's runner checks a call against (@yaks/tools).
export let schemaOf = (tool: ToolDef) => ({
  type: 'object' as const,
  properties: tool.input,
  required: needed(tool),
})

// One argument, as its schema's type says to read it. A model sends what it
// sends — a number as a string, `"true"` for a flag — so the type it was
// declared under is what it becomes, and a value that cannot become that is
// refused by name. A schema naming no type takes the value as it came.
let typed = (arg: string, schema: Arg, v: unknown) => {
  let no = (why: string) => new CallError('arguments', `${arg} ${why}`)
  if (v == null) throw no('is required')
  if (schema.type == 'number' || schema.type == 'integer') {
    let n = typeof v == 'number' ? v : Number(String(v))
    if (!Number.isFinite(n)) throw no('is a number')
    return n
  }
  if (schema.type == 'boolean') {
    if (typeof v == 'boolean') return v
    if (v === 'true' || v === 'false') return v == 'true'
    throw no('is true or false')
  }
  if (schema.type != 'string') return v
  if (typeof v == 'object') throw no('is text')
  return String(v)
}

// The call's arguments, read under the declared inputs. An argument nobody
// declared is dropped: it can fill no hole, and refusing it would only teach
// the model to guess again. One the caller may leave out and did is dropped
// too, and what is missing from here is what makes a hole absent below.
let args = (tool: ToolDef, sent: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(tool.input)
      .filter(([arg]) => sent[arg] != null || needed(tool).includes(arg))
      .map(([arg, schema]) => [arg, typed(arg, schema, sent[arg])]),
  )

// A variable the caller left empty, travelling as a value. It takes the key
// that held it with it: a column nobody named is a column nobody writes, never
// the word `undefined` in the row.
let ABSENT = Symbol('absent')

// An argument the caller left out. A variable that is not an argument at all
// is not a gap — it is an alias, and it travels on untouched.
let gaps = (s: string, tool: ToolDef, vals: Record<string, unknown>) =>
  [...s.matchAll(VAR)].some((m) =>
    m[1] && m[1] in tool.input && !(m[1] in vals)
  )

// One template string, bound. A string that is NOTHING but a bound variable
// becomes the value itself with its type — `"$miles"` writes the number 5, not
// "5" — and a variable inside a sentence is spliced in as text. `$$` is a
// dollar sign, and an unbound `$name` is the alias it was.
let fill = (
  s: string,
  tool: ToolDef,
  vals: Record<string, unknown>,
  encode: (v: unknown) => string,
) => {
  if (gaps(s, tool, vals)) return ABSENT
  let only = ONLY.exec(s)
  if (only && only[1] in vals) return vals[only[1]]
  return s.replace(
    VAR,
    (whole, arg) => !arg ? '$' : arg in vals ? encode(vals[arg]) : whole,
  )
}

let filling = (
  v: unknown,
  tool: ToolDef,
  vals: Record<string, unknown>,
  encode: (v: unknown) => string,
): unknown =>
  typeof v == 'string'
    ? fill(v, tool, vals, encode)
    : Array.isArray(v)
    ? v.map((one) => filling(one, tool, vals, encode))
      .filter((one) => one !== ABSENT)
    : object(v)
    ? Object.fromEntries(
      Object.entries(v)
        .map(([k, one]) => [k, filling(one, tool, vals, encode)])
        .filter(([, one]) => one !== ABSENT),
    )
    : v

// And the components a generated template lets go: one left with no columns is
// a bare write, which says the thing for `recipe` and is half a sentence for
// `alias{name}`. Nothing a person wrote names any, so nothing a person wrote
// loses one.
let dropped = (v: unknown, drop: string[]): unknown =>
  Array.isArray(v)
    ? v.map((one) => dropped(one, drop))
    : object(v)
    ? Object.fromEntries(
      Object.entries(v).filter(([k, one]) =>
        !(drop.includes(k) && object(one) && !Object.keys(one).length)
      ),
    )
    : v

// One `&`-clause of a filter line, or absent when the argument it asks about
// is. A value is percent-encoded — a filter line is a query string, and a
// title with an `&` in it would otherwise read as the next filter.
let clause = (s: string, tool: ToolDef, vals: Record<string, unknown>) =>
  gaps(s, tool, vals) ? ABSENT : s.replace(
    VAR,
    (whole, arg) =>
      !arg ? '$' : arg in vals ? encodeURIComponent(String(vals[arg])) : whole,
  )

// The act this call makes: the bundle to write, or the filter line to read,
// with the caller's arguments in it. A clause whose argument the caller left
// out drops out of the line, and the rest of it still reads.
export let filled = (
  tool: ToolDef,
  sent: Record<string, unknown>,
): { apply?: unknown; query?: string } => {
  let vals = args(tool, sent)
  if (tool.query != null) {
    // A query that is nothing but one variable is a whole filter line passed
    // through, so it keeps its `&`s rather than being read as one clause.
    let only = ONLY.exec(tool.query)
    if (only && only[1] in tool.input) {
      return { query: String(vals[only[1]] ?? '') }
    }
    return {
      query: tool.query.split('&')
        .map((one) => clause(one, tool, vals))
        .filter((one) => one !== ABSENT && one !== '')
        .join('&'),
    }
  }
  return {
    apply: dropped(
      filling(tool.apply, tool, vals, (v) => String(v)),
      tool.drop ?? [],
    ),
  }
}

/**
 * An app's declared commands as TOOLS a graph can run itself (T-37605): the
 * declaration from the manifest, and a `run` that fills the template and hands
 * back what it made. @yaks/tools does the rest — it writes the call, lands the
 * answer beside it, and a call wearing a wake waits for its firing first.
 *
 * A tool ANSWERS bundles and never applies them: an `apply` template is the
 * bundles it means, landed by the runner as the caller, and a `query`
 * template is a read, so those bundles are rows that already exist and the
 * runner keeps its hands off them.
 *
 * This is the same template language the kernel's `command` tool fills
 * (workers/yak/declared.ts `ran`); what differs is where the filled act goes —
 * there, through the app's own HTTP doors; here, straight into the store that
 * declared it.
 */
export let commands = (said: Tools): Tool[] =>
  Object.entries(said).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: schemaOf(def),
    readOnly: def.query != null,
    run: (call: Bundle, graph: Graph) => {
      let act = filled(def, argsOf(call))
      if (act.query != null) return graph.read(act.query)
      return (Array.isArray(act.apply) ? act.apply : [act.apply]) as Bundle[]
    },
  }))
