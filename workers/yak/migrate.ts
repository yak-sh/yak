// What an older release left in a Store that the code a deploy takes now no
// longer reads, moved out of the way at each wake: a journal its words no
// longer keep ({@link unjournaled}), a column a finished contract emptied
// ({@link lifecycleColumns}), and each slot the object remembers rewritten
// into the one shape a deploy takes now ({@link documented}, {@link unholed},
// {@link unworded}, {@link respelled}). The schema its words compose is
// store-schema.ts's. {@link BOUNDARIES} names the stored shapes this code
// reads, for `yak admin deploys`.
import { dropDdl as journalDrop } from '@yaks/journal'
import {
  catalogue,
  col,
  type Driver,
  lit,
  notNull,
  select,
  table,
} from '@yaks/sql'
import { columns, unseat } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'

import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { Rule } from './mover.ts'

// T-65228: app stores never composed mail_inbox. T-65357 stopped owing new
// runs and ignores these old ones when arming alarms. The owner invokes
// the live mover explicitly; reading an app never runs cleanup.
// Restrict it to the reported archive-change shape, never-started/unclaimed,
// recorded before the owner-confirmed T-65357 deployment on October 4, 2026.
let DEAD_MAIL_BEFORE = '2026-10-04T19:07:36.000Z'
let deadMailFind = '.effect.handler=mail_inbox&.effect.state=pending' +
  '&.effect.kind=changed&.effect.comp=archived&.effect.attempts=0' +
  `&.effect.at<${DEAD_MAIL_BEFORE}` +
  '&!effect.lease_owner&!effect.lease_token&!effect.lease_expiry'

/** Remove only the dead run component, not its entity or its target/archive.
 * Guards also protect an attempt/claim made after selection. Keeping other
 * components avoids deleting unrelated data attached to the run entity. */
export let deadMailInboxMove = (row: Bundle): Bundle[] => {
  let e = row.effect as Comp | undefined
  if (
    !e || e.handler != 'mail_inbox' || e.state != 'pending' ||
    e.kind != 'changed' || e.comp != 'archived' || e.attempts !== 0 ||
    typeof e.at != 'string' || e.at >= DEAD_MAIL_BEFORE ||
    ['lease_owner', 'lease_token', 'lease_expiry'].some((p) => e[p] != null)
  ) return []
  return [{
    entity: row.entity,
    effect: null,
    $was: {
      effect: Object.fromEntries([
        'handler',
        'state',
        'kind',
        'comp',
        'at',
        'attempts',
        'lease_owner',
        'lease_token',
        'lease_expiry',
      ].map((p) => [p, token(e[p] ?? null)])),
    },
  }]
}

/** Dead unhandled runs; the owner activates the app mover explicitly. */
export let deadMailInboxRule: Rule & { find: string } = {
  mark: 'yak/store/dead-mail-inbox/1',
  live: 'apps',
  find: deadMailFind + '&*',
  move: deadMailInboxMove,
}

/** The five type words the short manifest used, and the JSON Schema each
 * meant. Frozen here rather than read off vocab.ts: what a stored slot meant is
 * history, and history does not move when the platform's words do. */
let WAS: Record<string, Record<string, unknown>> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: { type: 'string', format: 'date-time' },
  url: { type: 'string', format: 'uri' },
}

let record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/**
 * A document with every property saying its type (T-37986). A property once
 * could say none, and was stored and read as text, so `"type": "string"` is
 * what it always meant; the loader now refuses a property that says none.
 * `null` where every property already says one.
 *
 * The build before this one still accepts a property with no type, so a
 * manifest it planted during a rollback arrives here too, which is why this
 * runs at every wake rather than once.
 */
let typed = (doc: Record<string, unknown>): string | null => {
  if (!record(doc.$defs)) return null
  let moved = false
  let defs = Object.fromEntries(
    Object.entries(doc.$defs).map(([name, s]) => {
      if (!record(s) || s.tool === true || s.rule === true) return [name, s]
      if (!record(s.properties)) return [name, s]
      let props = Object.fromEntries(
        Object.entries(s.properties).map(([prop, c]) => {
          if (!record(c) || 'type' in c) return [prop, c]
          moved = true
          return [prop, { type: 'string', ...c }]
        }),
      )
      return [name, { ...s, properties: props }]
    }),
  )
  return moved ? JSON.stringify({ ...doc, $defs: defs }) : null
}

/**
 * A short type map, as the document it means. An app's `vocab.json` could be
 * written as one — `{"recipe": {"serves": "number"}}` — and that form is
 * gone: a manifest is a JSON Schema document and nothing converts one at the
 * door any more (vocab.ts `appDoc`).
 *
 * A store that last accepted one remembers it in its vocabulary slot, and is
 * rewritten at its next open (graph.ts `#reshaping`).
 *
 * `null` where there is nothing to do — nothing held, a document whose
 * properties all say their type, or something no reader could parse — which is
 * every store after one wake.
 *
 * `"tools": false` is the manifest's one word about itself, so it rides across
 * as the document's own; every other key is a component.
 *
 * A document is rewritten too when one of its properties says no type
 * ({@link typed}), at the same open and for the same reason.
 */
export let documented = (held: string): string | null => {
  let said: unknown
  try {
    said = JSON.parse(held)
  } catch {
    return null
  }
  if (!said || typeof said != 'object' || Array.isArray(said)) return null
  let body = said as Record<string, unknown>
  let keys = Object.keys(body)
  if (keys.some((k) => k.startsWith('$'))) return typed(body)
  if (!keys.length) return null
  let defs: Record<string, unknown> = {}
  let tools: boolean | undefined
  for (let [name, props] of Object.entries(body)) {
    if (name == 'tools' && typeof props == 'boolean') {
      tools = props
      continue
    }
    if (!props || typeof props != 'object' || Array.isArray(props)) return null
    defs[name] = {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: Object.fromEntries(
        Object.entries(props as Record<string, unknown>).map(([prop, word]) => [
          prop,
          { ...(WAS[String(word)] ?? WAS.text) },
        ]),
      ),
    }
  }
  return JSON.stringify(
    tools === undefined ? { $defs: defs } : { $defs: defs, tools },
  )
}

/**
 * A tools manifest with each `{{arg}}` hole written as the `$arg` variable it
 * became (c0ca24d4). A deploy refuses the hole (@yaks/tools/declared `parseTools`),
 * but a store that last accepted a manifest before then remembers it in its
 * tools slot, and is rewritten at its next open (graph.ts `#reshaping`).
 * `null` where there is nothing to do. The names a hole can hold never need
 * escaping in JSON, so the text is rewritten as it is held.
 */
export let unholed = (held: string): string | null => {
  let now = held.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, '$$$1')
  return now == held ? null : now
}

/** The five words a tool's argument was once written as, and the JSON Schema
 * each was shown to a host as (@yaks/tools/declared `schemaOf` before T-38021) —
 * frozen here for the same reason {@link WAS} is. */
let ARGS: Record<string, Record<string, unknown>> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: {
    type: 'string',
    description: 'a time, like 2026-09-01 or 2026-09-01T10:00:00Z',
  },
  url: { type: 'string', description: 'a url' },
}

// A tool whose arguments are words, or that says which may be left out rather
// than which must be sent.
let worded = (t: unknown) =>
  record(t) && ('optional' in t ||
    record(t.input) &&
      Object.values(t.input).some((w) => typeof w == 'string'))

// One tool in the shape a package declares one: each argument a JSON Schema,
// and `required` naming every argument but the ones it left `optional`.
let schemed = (t: Record<string, unknown>): Record<string, unknown> => {
  let { input, optional, ...rest } = t
  let args = record(input) ? input : {}
  let loose = Array.isArray(optional) ? optional : []
  let required = Object.keys(args).filter((a) => !loose.includes(a))
  return {
    ...rest,
    input: Object.fromEntries(
      Object.entries(args).map((
        [a, w],
      ) => [a, typeof w == 'string' ? { ...(ARGS[w] ?? ARGS.text) } : w]),
    ),
    ...(required.length ? { required } : {}),
  }
}

/**
 * A tools slot with every argument a JSON Schema (T-38021): a store remembers
 * the tools its last deploy handed it, as one of five words each, and is
 * rewritten at its next open (graph.ts `#reshaping`). `null` where there is
 * nothing to do.
 */
export let unworded = (held: string): string | null => {
  let said: unknown
  try {
    said = JSON.parse(held)
  } catch {
    return null
  }
  if (!record(said) || !Object.values(said).some(worded)) return null
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(said).map((
        [name, t],
      ) => [name, worded(t) ? schemed(t as Record<string, unknown>) : t]),
    ),
  )
}

// A clause in a postfix form, where a query line can hold one: after a quote,
// a `&` or a query string's own `?`, and before a quote or a `&`.
let POSTFIX =
  /(?<=['"`&?])\.([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)(\[[^\]\s]*\])?([!?])(?=['"`&])/g

/**
 * Text with each query clause in its one spelling (T-39341): `.p!` is `.p`,
 * `.edges[t]!` is `.edges[t]`, and `.p?` is `?p`. A store's tools slot is
 * rewritten at its next open (graph.ts `#reshaping`), since the parser refuses
 * the old spellings. `null` where there is nothing to do.
 */
export let respelled = (text: string): string | null => {
  let now = text.replace(
    POSTFIX,
    (m, word, pick = '', mark) =>
      mark == '!' ? `.${word}${pick}` : pick ? m : `?${word}`,
  )
  return now == text ? null : now
}

/** The stored shapes this code reads, each named by the pass that moved stores
 * into it, read per commit by `yak admin deploys`: a rollback across one would
 * serve rows the build before it cannot read. One-time passes leave their names
 * after their rules are deleted. A retained capability such as app lenses also
 * names the first shape its rules can produce, even though only declaring apps
 * move. Code without the name is code from before it could read that shape. */
export let BOUNDARIES = [
  'yak/store/directory-phone/1',
  'yak/store/phone-provider/1',
  // The directory's file left `yak/platform` for a new object, and only code
  // holding relocate.ts hands a request on from the rows left behind.
  'yak/store/directory-relocated/1',
  'yak/store/session-sending/1',
  'yak/store/session-sending/2',
  'yak/store/exception/1',
  'yak/store/git-repositories/1',
  'yak/store/git-commit/1',
  'yak/store/platform-words/1',
  'yak/store/dead-mail-inbox/1',
  'yak/store/lens/1',
  'yak/store/lens-contract/1',
  'yak/store/lens-view/1',
  'yak/store/interruption-contract/1',
  'yak/store/interruption-contract/2',
  'yak/store/interruption-contract/3',
  'yak/store/interruption/1',
  'yak/store/interruption/2',
  'yak/store/interruption/3',
  'yak/store/interruption/4',
  'yak/store/builder-takes/18',
  'yak/store/builder-takes/19',
  'yak/store/refusal/1',
  'yak/store/refusal-imported/1',
  'yak/store/packages/1',
  'yak/store/home/2',
  'yak/store/former/3',
  'yak/store/serves/4',
  'yak/store/handle/5',
  'yak/store/filed/6',
  'yak/store/tool/7',
  'yak/store/args/11',
  'yak/store/for/12',
  'yak/store/build_of/13',
  'yak/store/output_of/14',
  'yak/store/vale-creature-prompt/16',
  'yak/store/vale-figure-prompt/17',
  // The directory's `written` rows, which drafts and file histories became
  // (written.ts).
  'yak/store/written/1',
  'yak/store/session-imported/1',
  // Every space's handle (D-131924).
  'yak/store/space-store/1',
  // Every custom integration's owner (T-132635).
  'yak/store/integration-owner/1',
  // Every space's Operator's name (T-137432).
  'yak/store/operator-name/1',
  // No space keeps an empty plan, comped, budget or starter a hold gave it
  // (T-141144).
  'yak/store/hold-empty/1',
  // Every space's connected account is `seller`, not `stripe` (T-142134).
  'yak/store/seller/1',
  // Every space's $49 plan is Pro (T-151637).
  'yak/store/pro-plan/1',
  // Every app-store entity a personal, inherited or `readers` component
  // bears keeps its privacy, and a person's read is screened by it
  // (privacy-move.ts, T-156154).
  'yak/store/privacy/1',
  // Every letter a form wrote, and the address it went to, is kept to the
  // app's editors (form-mail-move.ts, T-157871).
  'yak/store/form-mail/1',
  // Every phone row text sign-up created is kept to the app's editors
  // (form-phone-move.ts, T-159292).
  'yak/store/form-phone/1',
  // Every address only a letter names is kept to the app's editors, as the
  // letter is (recipient-move.ts, T-159245).
  'yak/store/recipient/1',
  // Every person and relation a sign-up created is kept to the app's editors
  // (form-guest-move.ts, T-159339).
  'yak/store/form-guest/1',
  // What is featured is the platform's `featured` mark, never an
  // integration's own property or the home pages' list (featured-move.ts,
  // T-160642).
  'yak/store/integration-featured/1',
  'yak/store/demo-featured/1',
  // The directory's and the git store's numbers hold their letters
  // (T-164365).
  'yak/store/number-letter/1',
  // Every keyed write a store's log holds is kept under its writer's name for
  // its key (@yaks/api/log `rekey`, at a store's wake, T-166122).
  'yak/store/write-receipt-keys/1',
]

/** The column the interruption contract emptied before `attempt.state` and
 * `execution.state` became computed (3ec6d595e), dropped where no row holds a
 * value in it. An app's store keeps a column its words stopped naming, so
 * this is the one such column every store loses. A value still there stays,
 * read by nothing, since the words compute the state. */
export let lifecycleColumns = (d: Driver, vocab: Vocab) => {
  let emptied = ['attempt', 'execution'].filter((name) =>
    vocab.prop(name, 'state')?.computed &&
    columns(d, name).includes('state') &&
    !d.query(select({
      cols: [lit(1)],
      from: table(name),
      where: notNull(col('state')),
      limit: lit(1),
    })).length
  )
  unseat(d, emptied.map((name) => [name, 'state'] as const))
}

/** The journal's tables dropped from a store whose words keep no journal:
 * every app store raised them from cac5e3065 to T-65227, and nothing has read
 * them since (T-131164). A table its words declare as a component stays, and
 * one the store does not hold is not dropped again: any DDL moves the schema's
 * revision, and with it everything read of the schema. A drop that fails comes
 * back for the caller to report, and the store serves what it holds. */
export let unjournaled = (d: Driver, vocab: Vocab): Error[] => {
  if (vocab.comp('_tx')) return []
  let held = new Set(catalogue(d).map((o) => o.name))
  return journalDrop()
    .filter((s) => !vocab.comp(s.name) && held.has(s.name))
    .flatMap((s) => {
      try {
        d.query(s)
        return []
      } catch (e) {
        return [e as Error]
      }
    })
}
