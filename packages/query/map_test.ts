import { equal, test } from '@yaks/testing'
import { and, eq, or, present } from './ast.ts'
import { map } from './map.ts'

test('map reaches boolean and reverse-association children without changing siblings', () => {
  let untouched = present('book')
  let ast = and(
    untouched,
    or(eq('title', 'cake'), {
      ...present('reviews'),
      where: and(eq('title', 'icing')),
    }),
  )
  equal(map(ast, (c) => c), ast)
  let out = map(
    ast,
    (c) =>
      c.kind == 'pred' && c.path[0] == 'title'
        ? { ...c, path: ['doc', 'title'] }
        : c,
  )
  equal(
    out,
    and(
      untouched,
      or(eq('doc.title', 'cake'), {
        ...present('reviews'),
        where: and(eq('doc.title', 'icing')),
      }),
    ),
  )
  equal(out.clauses[0] === untouched, true)
  equal(
    ast.clauses[1],
    or(eq('title', 'cake'), {
      ...present('reviews'),
      where: and(eq('title', 'icing')),
    }),
  )
})
