// Tool identities and invocation receipts, shared by recorded work and reads.
import type { Bundle, Comp, Declared, Eid, Ready, Tool } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { namedTool } from '@yaks/graph/call'
import { asked, emitted, ready } from '@yaks/graph/declared'
import { token } from '@yaks/graph/sha256'
import { effectsIn, type Vocab } from '@yaks/vocab'
import { toolsDoc } from './vocab.ts'
import { executionState } from './state.ts'
import { valueIn } from './value.ts'
import { type Clock, system } from '@yaks/fp'

/** A runner's clock unless it is given one: the runtime's timers, and
 * `performance.now`, which the wall clock's adjustments never move, for how
 * long a call took. */
export let measuring: Clock = { ...system, now: () => performance.now() }

/** The two effects this package declares, as written in the vocabulary: the
 * call that is due now, and the one that is due once its wake has fired —
 * each a query the runner also asks on its own, for what a crash left. */
export let RULES: Declared[] = effectsIn(toolsDoc)
  .flatMap((e) => e.match ? [{ name: e.name, match: e.match }] : [])

/** Every call claimed and not yet answered: the identities explicit recovery
 * asks for beside the rules, which owe nothing for a claimed call. A call its
 * writer runs by an effect of its own (`tool_async`, @yaks/session) is that
 * effect's to recover, as it is that effect's to run (`call_ready`). */
export let HELD = '$call .call, .execution, !results, !tool_async'

/** The rule that selects a call due now — the one whose emit names the result
 * entity. */
export let READY = 'call_ready'

/** The rule that selects a deferred call once its wake has fired. */
export let WOKEN = 'call_woken'

// Each name's id, derived once: it is a hash, and a server that builds a
// runner per request names every tool it has each time.
let eids = new Map<string, Eid>()

/** The entity id a call points at for a tool of this name: the id the
 * vocabulary's `identity` on `tool.name` derives, so a graph's tool rows are
 * the same rows every time a runner is built. */
export let toolEid = (name: string): Eid => {
  let eid = eids.get(name)
  if (!eid) eids.set(name, eid = identityEid('tool', [name]))
  return eid
}

/** The row a registered tool advertises to stored calls and builders. */
export let toolRow = (tool: Tool): Bundle => {
  let named = namedTool(tool)
  return {
    entity: { eid: toolEid(named.name) },
    tool: {
      name: named.name,
      description: named.description,
      revision: named.revision ?? null,
    },
  }
}

/** The most characters of an answer's text {@link worded} says: the copy on
 * the result entity, what a model reads over MCP, a transcript's line. What
 * lies past it is counted, not said — the answer itself is the bundles. */
export let WORDS = 256 * 1024

/** The most characters an answer may take as JSON before the runner refuses
 * it as `too_large`: far below the longest string a JavaScript engine can
 * build, so a door that sends an answer whole (MCP, `/apply`, `--json`) never
 * fails to. */
export let MOST = 64 * 1024 * 1024

// JSON.stringify(answer, null, 2), said one bundle at a time.
let inset = (b: Bundle) =>
  '  ' + JSON.stringify(b, null, 2).replaceAll('\n', '\n  ')

// A search answer carries a query-only hit, not the entity's whole body: the
// id it is called by (its human id where it has one, @yaks/graph/hit), the
// kind, title and words that found it, and, for a neighbour of something a
// call just made, the entity it is `near` and its `status`. Say that hit as one
// line for an MCP reader; structuredContent keeps its fields.
let hitOf = (b: Bundle): Comp | null => {
  let hit = b.hit as Comp | undefined
  return hit && typeof hit == 'object' && typeof hit.kind == 'string' &&
      typeof hit.snippet == 'string'
    ? hit
    : null
}

let hitLine = (b: Bundle, hit: Comp): string => {
  // deno-lint-ignore no-control-regex -- the search markers are intentional
  let mark = /\x01([^\x02]*)\x02/g
  // deno-lint-ignore no-control-regex -- a result must not command a terminal
  let ctrl = /[\x00-\x1f\x7f-\x9f]/g
  let clean = (s: string) => s.replace(/\s+/g, ' ').replace(ctrl, '').trim()
  let said = (k: string) => typeof hit[k] == 'string' ? clean(hit[k]) : ''
  let id = said('id') || b.entity.eid
  let title = said('title')
  let status = said('status')
  let near = said('near')
  let source = hit.source == 'meaning' ? ' (meaning)' : ''
  let snippet = clean(String(hit.snippet).replace(mark, '*$1*'))
  return `${near ? `near ${near}: ` : ''}${id}${title ? ` ${title}` : ''} · ${
    clean(String(hit.kind))
  }${status ? ` ${status}` : ''}${source}${snippet ? ` — ${snippet}` : ''}`
}

// What a tool's text answer carries: the spine every row has (@yaks/kernel),
// its words, the call it answers, and a fault's `refusal` or `exception`. An
// entity carrying more (a transcript entry, a comment, a memory, a row a tool
// made) is data, and its words alone would drop which one it is and who wrote
// it.
let SPOKEN = new Set([
  'entity',
  'created',
  'updated',
  'content',
  'output',
  'refusal',
  'exception',
])

// A bundle said as a line of its own: the words a call said, or a hit. Words
// are what a tool answered under a name of its own (`$said`) or aimed at the
// call (`output{source}`, which a text answer keeps once it is written): a row
// the answer read or wrote is data even when words are all it holds, since
// its words alone would drop which entity it is. Null for data, said whole.
let line = (b: Bundle): string | null => {
  let body = (b.content as Comp | undefined)?.body
  if (
    typeof body == 'string' && (b.entity.eid[0] == '$' || !!b.output) &&
    Object.keys(b).every((k) => k[0] == '$' || SPOKEN.has(k))
  ) return body
  let hit = hitOf(b)
  return hit ? hitLine(b, hit) : null
}

/**
 * A tool's answer as text: each bundle as a line where it is one — a text
 * answer's `content{body}`, or a compact `hit` line for a search result — and
 * the rest as JSON, each run of data bundles one JSON array, so the data in an
 * answer always parses and the lines between read as lines. An answer of data
 * alone is one array, `JSON.stringify(answer, null, 2)`. An entity that
 * carries words among other components (a transcript entry, a comment) is
 * data: said whole, its eid and its writer with its words. It is copied onto
 * the result entity as `content{body}` so a model, a terminal and a transcript
 * all read the answer the same way. It says at most `most` characters, each
 * bundle only once it is reached, and counts the rest, so an answer of any
 * size words in bounded time and space.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let said = (body: string) => ({
 *   entity: { eid: '$said' },
 *   content: { body },
 *   output: { source: 'c1' },
 * })
 * assertEquals(worded([said('one'), said('two')]), 'one\ntwo')
 * let entry = { ...said('hi'), entry: { session: 's', seq: 2 } }
 * assertEquals(
 *   worded([said('one'), entry, said('two')]),
 *   'one\n' + JSON.stringify([entry], null, 2) + '\ntwo',
 * )
 * assertEquals(
 *   worded([said('one'), said('two'), said('three')], 5),
 *   'one\nt\n… 2 of 3 not said: an answer is worded in 5 characters',
 * )
 * ```
 */
export let worded = (answer: Bundle[], most = WORDS): string => {
  if (!answer.length) return '[]'
  // A leading run's `[` is outside the budget, as the closing line is: the
  // budget is the answer's own characters.
  let open = ''
  let text = ''
  let run = false
  for (let [i, b] of answer.entries()) {
    let words = line(b)
    let s = words != null
      ? (run ? '\n]' : '') + (i ? '\n' : '') + words
      : (run ? ',\n' : i ? '\n[\n' : '') + inset(b)
    if (!i && words == null) open = '[\n'
    run = words == null
    if (text.length + s.length > most) {
      return `${open}${text}${s.slice(0, most - text.length)}\n… ` +
        `${answer.length - i} of ${answer.length} not said: an answer is ` +
        `worded in ${most} characters`
    }
    text += s
  }
  return open + text + (run ? '\n]' : '')
}

/**
 * A tool's answer as the texts a door that sends several sends (MCP's content
 * blocks): its data first, as JSON, then the lines said beside it, so a reader
 * that parses the first text finds the data whole and nothing glued onto it.
 * An answer of one kind is one text, {@link worded}.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let row = { entity: { eid: 't1' }, doc: { title: 'Mossvale' } }
 * let note = { entity: { eid: '$said' }, content: { body: 'Checked.' } }
 * assertEquals(texts([row, note]), [JSON.stringify([row], null, 2), 'Checked.'])
 * assertEquals(texts([row]), [worded([row])])
 * ```
 */
export let texts = (answer: Bundle[], most = WORDS): string[] => {
  let words = answer.filter((b) => line(b) != null)
  let data = answer.filter((b) => line(b) == null)
  return words.length && data.length
    ? [worded(data, most), worded(words, most)]
    : [worded(answer, most)]
}

/**
 * A tool's answer as data, for a reader that parses rather than reads: the
 * bundles under `result`, or, from a tool that declares an `outputSchema`
 * because its answer is not entities, the {@link valueIn} it answered in that
 * shape. A refusal carries no such value, and is its bundles like any other.
 * MCP sends this as `structuredContent`; `yak … --json` prints it.
 */
export let structured = (
  tool: { outputSchema?: Record<string, unknown> },
  answer: Bundle[],
): Record<string, unknown> =>
  (tool.outputSchema ? valueIn(answer) : undefined) ?? { result: answer }

// The runner's own record of one call, told apart from the answer by identity,
// never by shape: a tool that reads transcripts answers other calls and their
// results, and those are the answer.
let owned = (call: Eid) => (b: Bundle): boolean =>
  b.entity.eid == call || (b.result as Comp | undefined)?.call == call

/**
 * Did this call fail? Read from the runner's own record — `execution{state}`
 * on the call — rather than guessed from the shape of the answer: a tool that
 * queries for broken rows (or failed calls) returns entities carrying `error`,
 * `exception` and `execution`, and reporting faults is not itself a fault.
 */
export let faulted = (landed: Bundle[], call: Eid): boolean => {
  let row = landed.find((b) => b.entity.eid == call)
  return !!row && ['failed', 'interrupted'].includes(
    executionState(row, landed) ?? '',
  )
}

/**
 * What a call answered, for display: the tool's own bundles, without the
 * runner's record of this call — the call itself and its result, which
 * carries a copy of the answer's text so a transcript can show one line per
 * result; a caller rendering the answer itself would otherwise show it twice.
 */
export let answerOf = (landed: Bundle[], call: Eid): Bundle[] =>
  landed.filter((b) => !owned(call)(b))

/** Plan invocation receipts from the declared rules, including their stable IDs. */
export let results = (
  vocab: Vocab,
  now: () => number,
): {
  rules: Ready[]
  /** {@link HELD}, as this graph can query it, or nothing where a graph
   * records no claims */
  held?: Ready['plan']['patterns'][number]['filter']
  ending: (
    call: Bundle,
    started: number | undefined,
    state: string,
    said: Bundle[],
    before?: string | null,
  ) => Bundle[]
} => {
  // The rules as this graph can query them (@yaks/graph `asked`). A graph that
  // schedules nothing never loaded the wake components: there `!wake` matches
  // everything and drops out, and `call_woken`, which requires them, never
  // matches — one rule text, correct in both graphs.
  let plans: Ready[] = ready(RULES)
    .map((p) => ({ ...p, plan: asked(p.plan, vocab) }))
    .filter((p): p is Ready => !!p.plan)
  let answering = plans.find((p) => p.rule.name == READY)!
  let woken = plans.find((p) => p.rule.name == WOKEN)
  // HELD as this graph can query it, the way the rules are asked.
  // A graph that records no claims (no `execution`) holds none.
  let held = asked(ready([{ name: 'held', match: HELD }])[0].plan, vocab)
    ?.patterns[0].filter
  // The result entity, built the way the rule would write it: one match of
  // `call_ready`, emitted. Its id is derived from that match, so it is the
  // same entity however many times a call is run.
  let attached = (id: Eid, ms?: number, sleeps = false): Bundle => {
    let rule = sleeps && woken ? woken : answering
    let name = rule.plan.patterns[0].entity!
    let [made] = emitted(rule, {
      entities: [id, null],
      vars: { [name]: id },
    }, vocab)
    return {
      ...made,
      result: { ...made.result as Comp, ...ms == null ? {} : { ms } },
    }
  }

  // What ends a claimed call: the result the rule names, worded from what it
  // said, and the claim moved on from `running`, refused if another hand
  // moved it first.
  // How long it ran is left out where nobody saw it start.
  let ending = (
    call: Bundle,
    started: number | undefined,
    state: string,
    said: Bundle[],
    before: string | null = 'running',
  ): Bundle[] => [
    {
      ...attached(
        call.entity.eid,
        started == null ? undefined : Math.round(now() - started),
        !!call.wake,
      ),
      content: { body: worded(said) },
      $was: { result: { call: null } },
    },
    {
      entity: { eid: call.entity.eid },
      execution: { by: (call.execution as Comp)?.by ?? null },
      ...(state == 'interrupted' ? { interrupted: { code: 'transport' } } : {}),
      $was: {
        execution: {
          by: before == null ? null : token((call.execution as Comp)?.by),
        },
      },
    },
  ]

  return { rules: plans, held, ending }
}

export { said } from './said.ts'
export { display } from './display.ts'
