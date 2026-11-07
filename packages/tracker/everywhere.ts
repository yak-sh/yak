// Every bug door reads every tracker on yaks.app: the platform's, and each
// space's, which keeps the bugs of that space's apps. The platform tracker
// lists the space trackers it has routed to; each is read in parallel through
// the same scoped read, and its rows name the scope they came from.
import type { Bundle } from '@yaks/graph'
import { spaces } from './remote.ts'
import { type Options, read } from './routes.ts'

/** Every tracker's rows, the platform's first, a space tracker's naming its
 * space in `$scope`; and each tracker that could not be read, and why. */
export type Everywhere = { rows: Bundle[]; unread: string[] }

/** What `each` reads from the platform tracker (`platform`) and from every
 * space tracker, all at once. The platform's failure is the read's; a space
 * tracker's, or its list's, is said in `unread` beside the rest. */
export let everywhere = async (
  options: Options,
  each: (scope: string) => Promise<Bundle[]>,
  go: typeof fetch = fetch,
): Promise<Everywhere> => {
  let unread: string[] = []
  let [rows, ...theirs] = await Promise.all([
    each('platform'),
    ...(await spaces(options.remote ?? {}, go).catch((error) => {
      unread.push(`the list of space trackers: ${(error as Error).message}`)
      return []
    })).map((scope) =>
      each(scope).then(
        (got) => got.map((row) => ({ ...row, $scope: scope })),
        (error) => {
          unread.push(`space ${scope}: ${(error as Error).message}`)
          return []
        },
      )
    ),
  ])
  return { rows: [...rows, ...theirs.flat()], unread }
}

/** A page of the bugs `query` answers in the tracker `scope` names, at most
 * `limit`; a refusal throws. */
export let bugsIn = async (
  options: Options,
  scope: string,
  query: string,
  limit = 50,
  go: typeof fetch = fetch,
): Promise<Bundle[]> => {
  let got = await read(
    options,
    'bugs',
    new URLSearchParams({ scope, query, limit: String(limit) }),
    undefined,
    go,
  )
  if (!got.ok) throw Error(got.error)
  if (!Array.isArray(got.value)) throw Error('tracker answered no bug rows')
  return got.value as Bundle[]
}
