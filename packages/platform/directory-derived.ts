// The directory's query spellings for visibility and latest activity. Old
// rows are read from their source until the mover has indexed them.
import type { Derived } from '@yaks/sql'
import {
  among,
  and,
  col,
  eq,
  exists,
  type Expr,
  fn,
  join,
  lit,
  ne,
  not,
  notNull,
  op,
  or,
  select,
  sub,
  table,
  when,
} from '@yaks/sql/core'
import { ADMIN, BOT, DEMO, NUMBERS } from './bots.ts'
import { PLATFORM_SPACE } from './names.ts'

// Whether the entity `owner` has a row in `comp` that `where` holds of.
let has = (comp: string, owner: Expr, where?: (row: string) => Expr) =>
  exists(select({
    cols: [lit(1)],
    from: table(comp, `__${comp}`),
    where: and(
      eq(col('entity', `__${comp}`), owner),
      ...where ? [where(`__${comp}`)] : [],
    ),
  }))
// A time, or '' for none, so `max` of several reads the latest of those kept.
let at = (q: Expr) => fn('coalesce', q, lit(''))
let latest = (...times: Expr[]) =>
  fn('nullif', fn('max', ...times.map(at), lit('')), lit(''))
let usedAt = (owner: Expr) =>
  sub(select({
    cols: [col('at', 'u')],
    from: table('used', 'u'),
    where: eq(col('entity', 'u'), owner),
  }))

/** Whether the person `owner` is nobody's, as @yaks/platform/bots and
 * directory.ts `testIs` say: an address or a number the fleet holds (the
 * admin's and the demo's addresses aside), the `test` mark, or a newcomer a
 * browser did not open. */
let personTestBefore = (owner: Expr): Expr =>
  or(
    has('test', owner),
    has('email', owner, (e) => {
      let address = col('address', e)
      return and(
        or(
          op('glob', address, lit(`*${BOT}`)),
          op('glob', address, lit('*.invalid')),
        ),
        not(among(address, [lit(ADMIN), lit(DEMO)])),
      )
    }),
    has('phone', owner, (p) =>
      among(
        col('number', p),
        [...NUMBERS].map((n) => lit(n)),
      )),
    has('newcomer', owner, (n) =>
      and(
        notNull(col('client', n)),
        ne(col('client', n), lit('browser')),
      )),
  )

/** Whether the space `owner` is a test space: somebody sits in it, and
 * nobody who does is anybody's. */
let spaceTestBefore = (owner: Expr): Expr =>
  and(
    seated(owner),
    not(exists(select({
      cols: [lit(1)],
      from: table('member', 'm'),
      where: and(
        eq(col('space', 'm'), owner),
        not(personTestBefore(col('person', 'm'))),
      ),
    }))),
  )
let seated = (owner: Expr) =>
  exists(select({
    cols: [lit(1)],
    from: table('member', 's'),
    where: eq(col('space', 's'), owner),
  }))

/** When the space `owner` was last used, or any app in it not in the trash. */
let spaceActiveBefore = (owner: Expr): Expr =>
  latest(
    usedAt(owner),
    sub(select({
      cols: [fn('max', col('at', 'au'))],
      from: table('app', 'a'),
      joins: [
        join(table('used', 'au'), eq(col('entity', 'au'), col('entity', 'a'))),
      ],
      where: and(
        eq(col('space', 'a'), owner),
        not(has('trashed', col('entity', 'a'))),
      ),
    })),
  )

/** When the person `owner` was last active: their last use, their last
 * sign-in, and the latest activity of each space they own but the
 * platform's own. */
let personActiveBefore = (owner: Expr): Expr =>
  latest(
    usedAt(owner),
    sub(select({
      cols: [col('at', 'si')],
      from: table('signed_in', 'si'),
      where: eq(col('entity', 'si'), owner),
    })),
    sub(select({
      cols: [fn('max', spaceActiveBefore(col('space', 'o')))],
      from: table('member', 'o'),
      where: and(
        eq(col('person', 'o'), owner),
        eq(col('role', 'o'), lit('owner')),
        not(has('space', col('space', 'o'), (s) =>
          eq(col('slug', s), lit(PLATFORM_SPACE)))),
      ),
    })),
  )

let indexed =
  (before: (owner: Expr) => Expr, read: (owner: Expr) => Expr) =>
  (owner: Expr): Expr =>
    when([[has('directory_order', owner), read(owner)]], before(owner))

let marked = (owner: Expr) => has('test', owner)
let ordered = (owner: Expr) =>
  sub(select({
    cols: [col('at', 'o')],
    from: table('directory_order', 'o'),
    where: eq(col('entity', 'o'), owner),
  }))

let personTest = indexed(personTestBefore, marked)
let spaceTest = indexed(spaceTestBefore, marked)
let personActive = indexed(personActiveBefore, ordered)
let spaceActive = indexed(spaceActiveBefore, ordered)

/** The directory's computed `person` and `space` properties, for the
 * directory store's derived-property registry (@yaks/sql `Derived`). Neither
 * is read with a whole component: a read names the one it asks for. */
export let directoryDerived: Derived = {
  'person.test': { stable: true, tag: 'bool', whole: false, expr: personTest },
  'person.active': {
    stable: true,
    tag: 'time',
    whole: false,
    expr: personActive,
  },
  'space.test': { stable: true, tag: 'bool', whole: false, expr: spaceTest },
  'space.active': {
    stable: true,
    tag: 'time',
    whole: false,
    expr: spaceActive,
  },
}
