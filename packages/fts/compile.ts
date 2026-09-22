// The query half: a bare word in a query compiles to an FTS5 match.
//
// A query mixes words and filters — `hobbit .price<20` — and @yaks/query parses
// each bare word as a `text` clause. @yaks/sql compiles every clause except
// that one; this module is the @yaks/sql extension that compiles it, registered
// through `compile(ast, vocab, { extend: [search(fields)] })`.
//
// One clause is one word, or one run somebody quoted (@yaks/query splits on
// whitespace), so `term` converts it — a word matches as a prefix, a quoted run
// stays a phrase — and several words are ANDed together the way every other
// clause is.
//
// The generated condition is one `in` subquery per indexed component, ORed
// together: an index's rowid is the entity's integer id in the `entity` table,
// so a match yields ids the surrounding statement already uses, and no join is
// needed. The AND between words comes from how @yaks/sql combines clauses, not
// from this file.

import { type Extension, FALSE, or, raw } from '@yaks/sql'
import { type Field, indexes, indexName } from './fields.ts'
import { term } from './term.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// The @yaks/sql extension that resolves bare words against the search indexes.
// It handles the `text` clause, covering every indexed field. Without this
// extension @yaks/sql rejects bare words rather than assuming an index exists.
export let search = (fields: Field[]): Extension => ({
  name: 'fts',
  compile: {
    text: (clause, site) => {
      if (clause.kind != 'text') return null
      let t = term(clause.value)
      // A search containing no word matches nothing. Compiling it to a
      // constant false keeps the query away from the index rather than
      // widening the result set.
      if (!t) return FALSE
      return or(
        ...indexes(fields).map(({ comp }) => {
          let fts = q(indexName(comp))
          return raw({
            sql:
              `${site.owner} in (select rowid from ${fts} where ${fts} match ?)`,
            params: [t],
          })
        }),
      )
    },
  },
})
