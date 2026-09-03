// An app's OWN tools (T-32685): the `tools.json` at the root of an app's
// files, read by app_deploy and kept in that app's store beside its
// vocabulary (store.ts), and listed at the platform's MCP door as
// `<app>__<tool>` for everyone who can reach the app. One entry is a
// sentence, an input, and one act:
//
//   { "log_run": {
//       "description": "Log a run for the club leaderboard",
//       "input": { "who": "text", "miles": "number" },
//       "apply": { "entity": { "eid": "$run" },
//                  "run": { "who": "{{who}}", "miles": "{{miles}}" } } },
//     "leaderboard": {
//       "description": "This month's runs",
//       "input": { "since": "time" },
//       "query": ".run!&.created.at>={{since}}" } }
//
// The act is a TEMPLATE over the app's own store: `apply` is the wire's
// entity bundle (or a list of them) and `query` is a filter line, each with
// `{{arg}}` holes filled from the call's arguments and typed by the declared
// input. A hole naming an input nobody declared is refused at deploy, because
// a tool that cannot be filled is one an agent calls once and gives up on.
//
// Nothing here reaches the store: filling a template makes the same body a
// page's own `apply` and `query` send, and the call goes through the app's
// ordinary doors with the caller's identity and the app's access rule
// (workers/yak/declared.ts). So a tool can do exactly what the person
// calling it could do on the page, and never more.
import { comps, type PropType } from '../types.ts'
import { TYPES, type Vocab } from './vocab.ts'

// One declared tool, as written. `apply` and `query` are the two acts; an
// entry names exactly one.
export type ToolDef = {
  description: string
  input: Record<string, PropType>
  apply?: unknown
  query?: string
}

export type Tools = Record<string, ToolDef>

export let TOOLS_EXAMPLE =
  '{"log_run": {"description": "Log a run", "input": {"miles": "number"}, ' +
  '"apply": {"entity": {"eid": "$run"}, "run": {"miles": "{{miles}}"}}}}'

// The keys an entry may carry. Unknown ones are refused rather than ignored,
// so a misspelling is a sentence at deploy and not a tool that quietly does
// half of what was meant. The list grows: `view` (T-32687) names the page an
// answer draws itself in.
let KEYS = ['description', 'input', 'apply', 'query']

// A tool's name and an input's name: what a host can spell. The MCP door
// namespaces a tool as `<app>__<tool>`, and an app slug carries no
// underscore, so no app's word can collide with another's or with the
// platform's own tools.
let NAME = /^[a-z][a-z0-9_]{0,39}$/

// A hole, and the whole of a string that is nothing but one — the difference
// between a value passed through with its type and a value spliced into text.
let HOLE = /\{\{([a-z][a-z0-9_]*)\}\}/g
let ONLY = /^\{\{([a-z][a-z0-9_]*)\}\}$/

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// The wire's own keys beside the components: what an entity bundle may say
// that is not a component name (src/mutation.ts EntityLiteral).
let WIRE = ['entity', 'dependency', 'tombstone', 'was']

// Every hole in a template, wherever the strings are.
let holes = (v: unknown, found: Set<string> = new Set()): Set<string> => {
  if (typeof v == 'string') {
    for (let m of v.matchAll(HOLE)) found.add(m[1])
  } else if (Array.isArray(v)) { for (let one of v) holes(one, found) }
  else if (object(v)) { for (let one of Object.values(v)) holes(one, found) }
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

// The manifest as written, checked whole: every problem in one sentence, the
// way vocab.json refuses (T-32628), because an agent that fixes one problem
// per deploy stops after the second.
export let parseTools = (source: unknown, vocab: Vocab = {}): Tools => {
  if (typeof source == 'string') {
    if (!source.trim()) return {}
    try {
      source = JSON.parse(source)
    } catch {
      throw new Error(`tools.json is not JSON — ${TOOLS_EXAMPLE}`)
    }
  }
  if (!object(source)) {
    throw new Error(`tools.json is an object — ${TOOLS_EXAMPLE}`)
  }
  let words = [...Object.keys(comps), ...Object.keys(vocab)]
  let wrong: string[] = []
  let out: Tools = {}
  for (let [name, entry] of Object.entries(source)) {
    if (!NAME.test(name)) {
      wrong.push(`${JSON.stringify(name)} is not a tool name (a-z, 0-9, _)`)
      continue
    }
    if (!object(entry)) {
      wrong.push(`${name} is an object — ${TOOLS_EXAMPLE}`)
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
    let input: Record<string, PropType> = {}
    if (entry.input != null) {
      if (!object(entry.input)) {
        wrong.push(`${name}.input is an object of arguments — ${TOOLS_EXAMPLE}`)
      } else {
        for (let [arg, type] of Object.entries(entry.input)) {
          if (!NAME.test(arg)) {
            wrong.push(
              `${name}.input: ${JSON.stringify(arg)} is not an ` +
                'argument name (a-z, 0-9, _)',
            )
          } else if (typeof type != 'string' || !(type in TYPES)) {
            wrong.push(
              `${name}.input.${arg} is ${JSON.stringify(type)} — one of ${
                Object.keys(TYPES).join(', ')
              }`,
            )
          } else input[arg] = type as PropType
        }
      }
    }
    let acts = ['apply', 'query'].filter((k) => entry[k] != null)
    if (acts.length != 1) {
      wrong.push(
        `${name} does one thing: apply (a bundle to write) or query (a ` +
          'filter line to read)',
      )
    }
    if (entry.query != null && typeof entry.query != 'string') {
      wrong.push(`${name}.query is a filter line, like ".run!"`)
    }
    if (
      entry.apply != null && !object(entry.apply) && !Array.isArray(entry.apply)
    ) {
      wrong.push(`${name}.apply is an entity bundle, or a list of them`)
    }
    // A hole that names no input can never be filled, and a component nobody
    // declared can never be written — both are the deploy's to catch, since
    // the alternative is an agent calling the tool and reading `unknown
    // component` from a store it cannot see.
    for (let hole of holes(entry.apply ?? entry.query)) {
      if (!(hole in input)) {
        wrong.push(
          `${name}: {{${hole}}} names no input — declare it in ` +
            `${name}.input`,
        )
      }
    }
    for (let comp of named(entry.apply)) {
      if (!words.includes(comp)) {
        wrong.push(
          `${name}.apply: ${comp} is not a component — declare it in ` +
            'vocab.json, or use one the platform already says',
        )
      }
    }
    out[name] = {
      description: String(entry.description ?? ''),
      input,
      ...(entry.apply != null ? { apply: entry.apply } : {}),
      ...(typeof entry.query == 'string' ? { query: entry.query } : {}),
    }
  }
  if (wrong.length) throw new Error(`tools.json: ${wrong.join('; ')}`)
  return out
}

// The tool's arguments as JSON Schema, which is what a host shows the model.
// Every declared input is required: a hole with nothing to fill it would be
// spliced into the template as the word `undefined`.
export let schemaOf = (tool: ToolDef) => ({
  type: 'object' as const,
  properties: Object.fromEntries(
    Object.entries(tool.input).map(([arg, type]) => [arg, {
      type: type == 'number' ? 'number' : type == 'bool' ? 'boolean' : 'string',
      ...(type == 'time'
        ? { description: 'a time, like 2026-09-01 or 2026-09-01T10:00:00Z' }
        : type == 'url'
        ? { description: 'a url' }
        : {}),
    }]),
  ),
  required: Object.keys(tool.input),
})

// One argument, as the declared type says to read it. A model sends what it
// sends — a number as a string, `"true"` for a flag — so the type it was
// declared under is what it becomes, and a value that cannot become that is
// refused by name.
let typed = (arg: string, type: PropType, v: unknown) => {
  if (v == null) throw new Error(`${arg} is required`)
  if (type == 'number') {
    let n = typeof v == 'number' ? v : Number(String(v))
    if (!Number.isFinite(n)) throw new Error(`${arg} is a number`)
    return n
  }
  if (type == 'bool') {
    if (typeof v == 'boolean') return v
    if (v === 'true' || v === 'false') return v == 'true'
    throw new Error(`${arg} is true or false`)
  }
  if (typeof v == 'object') throw new Error(`${arg} is text`)
  return String(v)
}

// The call's arguments, read under the declared inputs. An argument nobody
// declared is dropped: it can fill no hole, and refusing it would only teach
// the model to guess again.
let args = (tool: ToolDef, sent: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(tool.input).map((
      [arg, type],
    ) => [arg, typed(arg, type, sent[arg])]),
  )

// One template string, filled. A string that is NOTHING but a hole becomes
// the value itself with its type — `"{{miles}}"` writes the number 5, not
// "5" — and a hole inside a sentence is spliced in as text.
let fill = (
  s: string,
  vals: Record<string, unknown>,
  encode: (v: unknown) => string,
) => {
  let only = ONLY.exec(s)
  if (only) return vals[only[1]]
  return s.replace(HOLE, (_, arg) => encode(vals[arg]))
}

let filling = (
  v: unknown,
  vals: Record<string, unknown>,
  encode: (v: unknown) => string,
): unknown =>
  typeof v == 'string'
    ? fill(v, vals, encode)
    : Array.isArray(v)
    ? v.map((one) => filling(one, vals, encode))
    : object(v)
    ? Object.fromEntries(
      Object.entries(v).map(([k, one]) => [k, filling(one, vals, encode)]),
    )
    : v

// The act this call makes: the bundle to write, or the filter line to read,
// with the caller's arguments in it. A value in a filter line is
// percent-encoded — a filter line is a query string, and a title with an `&`
// in it would otherwise read as the next filter.
export let filled = (
  tool: ToolDef,
  sent: Record<string, unknown>,
): { apply?: unknown; query?: string } => {
  let vals = args(tool, sent)
  if (tool.query != null) {
    return {
      query: String(
        fill(tool.query, vals, (v) => encodeURIComponent(String(v))) ??
          tool.query,
      ),
    }
  }
  return { apply: filling(tool.apply, vals, (v) => String(v)) }
}
