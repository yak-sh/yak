import { bareLine, kinded, parse, tokens, untokens } from '@yaks/query'
import { projection } from '@yaks/graph/read'
import { compile, Unsupported } from '@yaks/sql'
import { Unknown, type Vocab } from '@yaks/vocab'
import { operatorDoc } from '@yaks/platform/operator-vocab'
import type { Refusal } from '@yaks/api'

// The `.in=` rider: which app a read is scoped to. It is the platform's word,
// not the query grammar's, so it comes off the line before any store sees it —
// a store knows about components, and which of several stores to ask is a
// question only this side of the hop can answer. It is a clause like any
// other, so whitespace ends it as `&` does.
/// scope('.doc .in=recipes') -> { said: 'recipes', line: '.doc' }
/// scope('.in=me/trip&.doc|.task') -> { said: 'me/trip', line: '.doc|.task' }
export let scope = (line: string) => {
  let segs = tokens(bareLine(line))
  let said = segs.find((s) => /^\.in=/.test(s))?.slice(4)
  return { said, line: untokens(segs.filter((s) => !/^\.in=/.test(s))) }
}

/** Check a vocabulary refusal against the current code using no store data.
 * A newly readable query must keep its retry, including projections whose
 * syntax the older compiler refused. */
export let confirmedRefusal = (
  line: string,
  vocab: Vocab,
  old: Partial<Refusal>,
): Unknown | Unsupported | undefined => {
  try {
    let query = kinded(vocab, parse(line))
    compile(projection(vocab, query)?.query ?? query, vocab)
  } catch (e) {
    if (e instanceof Unknown && old.error == e.name && old.prop == e.prop) {
      return e
    }
    if (
      e instanceof Unsupported && old.error == e.name &&
      old.feature == e.feature &&
      e.feature == 'a component where a property belongs'
    ) return e
  }
}

// Teach after an unknown-name refusal so an app that declares one of these
// names keeps its own meaning. The Operator store is outside app reach.
export let queryRefusal = (error: unknown, at?: string): string | undefined => {
  if (!(error instanceof Error)) return
  let word = /(?:^|: )unknown prop: \.(\w+)(?= |$)/.exec(error.message)?.[1]
  if (word && operatorDoc.$defs?.[word]?.component) {
    return `.${word} is a component in the space's Operator store. ` +
      'In that space’s Operator, add self: true to graph_query. ' +
      `Platform admins can use yak admin query ${
        at?.split('/')[0] ?? '<space>'
      } ` +
      `'.${word}' --operator.`
  }
  let tombstone = /unknown prop(?:erty)?: \.?tombstone\b/.test(error.message)
  let trashed = /unknown prop(?:erty)?: \.?app\.trashed\b/.test(error.message)
  if (!tombstone && !trashed) return
  if (at == 'yak/platform' || trashed) {
    return 'Apps in the trash carry trashed{at, by}, a separate component. ' +
      "In yak/platform send q: '.app .trashed ?doc ?former' " +
      '(app.trashed is not a property, and .tombstone is not app trash). ' +
      "For your own spaces, app_list(space: '<space slug>') lists the " +
      'trash with ids for app_restore.'
  }
  return 'graph_query reads live entities; .tombstone is not a queryable ' +
    "component here. For app trash, app_list(space: '<space slug>') " +
    'lists ids for app_restore. For a deleted data row, send ' +
    "store_inspect(space: '<space slug>', app: '<app slug>', " +
    "eid: '<row eid>'); since and until count deletions in a time window. " +
    'store_restore puts the store back to a moment before the deletion.'
}

// `.in=` alone says which app to read and nothing about what: a line with no
// clause left reads nothing, and an empty answer reads as an empty app. So it
// is refused with a line that reads what the app keeps.
export let unasked = (
  slug: string,
  said: string,
  defs: Record<string, { tool?: unknown; rule?: unknown; extends?: unknown }>,
) => {
  let kinds = Object.entries(defs)
    .filter(([, d]) => !d.tool && !d.rule && !d.extends)
    .map(([name]) => name)
  let line = kinds.length ? `.${kinds[0]}&?doc` : '.doc'
  return `'.in=${said}' says which app to read, not what: a row carries ` +
    `the components its line names. ${slug} keeps ` +
    `${kinds.length ? kinds.join(', ') : 'doc'}, so ` +
    `'${line}&.in=${said}' reads ${kinds.length ? 'each with its doc' : 'them'}`
}
