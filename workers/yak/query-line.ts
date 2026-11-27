import { bareLine, kinded, parse, tokens, untokens } from '@yaks/query'
import { projection } from '@yaks/graph/read'
import { compile, Unsupported } from '@yaks/sql'
import { Unknown, type Vocab } from '@yaks/vocab'
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
let compileLine = (line: string, vocab: Vocab) => {
  let query = kinded(vocab, parse(line))
  compile(projection(vocab, query)?.query ?? query, vocab)
}

export let readable = (line: string, vocab: Vocab): boolean => {
  try {
    compileLine(line, vocab)
    return true
  } catch (e) {
    if (
      e instanceof Unknown || e instanceof Unsupported ||
      e instanceof SyntaxError
    ) {
      return false
    }
    throw e
  }
}

export let confirmedRefusal = (
  line: string,
  vocab: Vocab,
  old: Partial<Refusal>,
): Unknown | Unsupported | undefined => {
  try {
    compileLine(line, vocab)
  } catch (e) {
    if (e instanceof Unknown && old.error == e.name && old.prop == e.prop) {
      return e
    }
    if (
      e instanceof Unsupported && old.error == e.name &&
      old.feature == e.feature
    ) {
      return e
    }
  }
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
