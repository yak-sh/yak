// FTS5 retokenizes a whole external-content row to cut its best snippet.
// Bound that work: large transcripts get a term-centered text window instead.
import {
  as,
  col,
  eq,
  type Expr,
  fn,
  lit,
  op,
  select,
  sub,
  table,
  val,
  when,
} from '@yaks/sql'
import { CLOSE, OPEN } from './term.ts'

export let TOKENIZE = 64 * 1024

let join = (...parts: Expr[]) => parts.reduce((a, b) => op('||', a, b))

// The longest displayed phrase is a useful anchor even when a body repeats
// short terms thousands of times. Membership and ranking remain FTS5's.
let anchor = (marked: string) =>
  [...marked.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    .sort((a, b) => b.length - a.length)[0] ?? ''

let window = (text: Expr, needle: string, context: number): Expr => {
  let p = col('position'), source = text
  if (!needle) return lit(null)
  return sub(select({
    with: [{
      name: '__window',
      q: select({
        cols: [
          as(
            fn(
              'coalesce',
              fn('nullif', fn('instr', text, val(needle)), lit(0)),
              fn('instr', fn('lower', text), fn('lower', val(needle))),
            ),
            'position',
          ),
        ],
      }),
      materialized: true,
    }],
    cols: [when([[
      op('>', p, lit(0)),
      join(
        when([[op('>', p, lit(context * 4 + 1)), val('…')]], val('')),
        fn(
          'substr',
          source,
          fn('max', lit(1), op('-', p, lit(context * 4))),
          fn('min', op('-', p, lit(1)), lit(context * 4)),
        ),
        val(OPEN),
        fn('substr', source, p, fn('length', val(needle))),
        val(CLOSE),
        fn(
          'substr',
          source,
          op('+', p, fn('length', val(needle))),
          lit(context * 8),
        ),
        val('…'),
      ),
    ]], lit(null))],
    from: table('__window'),
  }))
}

export let cut = (
  fts: string,
  props: string[],
  marked: string,
  context: number,
  content?: string,
): Expr => {
  let size = props.map((p) => fn('coalesce', fn('length', col(p)), lit(0)))
    .reduce((a, b) => op('+', a, b))
  let needle = anchor(marked)
  let large = fn(
    'coalesce',
    ...props.map((p) => {
      let text = col(p)
      return window(text, needle, context)
    }),
    fn('substr', col(props[0]), lit(1), lit(context * 12)),
  )
  return sub(select({
    with: [{
      name: '__source',
      q: select({
        cols: props.map((p) =>
          as(fn('substr', col(p, content ?? fts), lit(1), lit(1024 * 1024)), p)
        ),
        ...content
          ? {
            from: table(content),
            where: eq(col('entity', content), col('rowid', fts)),
          }
          : {},
      }),
      materialized: true,
    }],
    cols: [
      when(
        [[op('>', size, lit(TOKENIZE)), large]],
        fn(
          'snippet',
          col(fts),
          lit(-1),
          val(OPEN),
          val(CLOSE),
          val('…'),
          lit(context),
        ),
      ),
    ],
    from: table('__source'),
  }))
}
