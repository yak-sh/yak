// The query half: a bare word in a query compiles to an FTS5 MATCH.
//
// A search line mixes words and filters — `hobbit .price<20` — and @yaks/query
// parses the bare word as a `text` clause. @yaks/sql compiles everything but
// that clause; this module is the @yaks/sql EXTENSION that compiles the clause,
// registered through `compile(ast, vocab, { extend: [search(fields)] })`.
//
// The condition is one `in` per indexed component, OR'd: because an index's
// rowid IS the entity's spine id, a match reads as a set of ids the surrounding
// statement already speaks, and needs no join. Several words AND together the
// way every other clause does — @yaks/sql composes them, not this file.

import { type Extension, FALSE, or, raw } from '@yaks/sql'
import { type Field, indexes, indexName } from './fields.ts'
import { term } from './term.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// The @yaks/sql extension that answers bare words out of the search indexes.
// It claims the `text` clause, replacing the dialect's own single-index
// lowering with one that covers every field indexed.
export let search = (fields: Field[]): Extension => ({
  name: 'fts',
  compile: {
    text: (clause, site) => {
      if (clause.kind != 'text') return null
      let t = term(clause.value)
      // A search with no word in it matches nothing. Saying so as a constant
      // false keeps it out of the index rather than widening the answer.
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
