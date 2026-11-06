import { tokens } from '@yaks/query'

/** A line's tokens written back as one line: `&` between clauses, nothing
 * around the `|` that separates two arms. */
/// joined(['.doc', '.task', '|', '.recipe']) -> '.doc&.task|.recipe'
export let joined = (segs: string[]) =>
  segs.reduce(
    (line, seg, i, all) =>
      line + (i && seg != '|' && all[i - 1] != '|' ? '&' : '') + seg,
    '',
  )

/** A line without the `?` a query string opens with, and any `&` after it. A
 * `?` before a word is the grammar's own (`?doc` asks for a component), so it
 * stays. */
export let bare = (line: string) =>
  line.replace(/^\?(?![A-Za-z_])/, '').replace(/^&+/, '')

// The `.in=` rider: which app a read is scoped to. It is the platform's word,
// not the query grammar's, so it comes off the line before any store sees it —
// a store knows about components, and which of several stores to ask is a
// question only this side of the hop can answer. It is a clause like any
// other, so whitespace ends it as `&` does.
/// scope('.doc .in=recipes') -> { said: 'recipes', line: '.doc' }
/// scope('.in=me/trip&.doc|.task') -> { said: 'me/trip', line: '.doc|.task' }
export let scope = (line: string) => {
  let segs = tokens(bare(line))
  let said = segs.find((s) => /^\.in=/.test(s))?.slice(4)
  return { said, line: joined(segs.filter((s) => !/^\.in=/.test(s))) }
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
