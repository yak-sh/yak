// A person's OAuth grants as the directory lists them (T-150051).
//
// The provider (@cloudflare/workers-oauth-provider) keeps each grant in KV
// as `grant:<person>:<id>` and lists a person's by a KV list and then a read
// of each key it names, the second waiting on the first: about 170 ms the
// first visit after idle. And a KV list lags KV's writes by up to a minute:
// measured live, a grant revoked a moment before was still listed (only the
// read of it found it gone) and one just connected was not listed for half a
// minute. Neither read can be cut inside the library, whose keys carry
// nothing a listing shows.
//
// So every grant also stands as an `oauth_grant` row in the directory,
// written as the provider writes KV (`through`): whatever writes a grant (a
// consent, a code exchanged, a token refreshed), its row is written first,
// and whatever deletes one (a disconnect, a client revoking its own token, a
// grant replaced), its row goes after. The rows hold every grant KV holds the
// moment it does, a revocation is gone from them at once, and a person's
// listing is one directory read in the trip their page already makes
// (`listing`). KV stays the record of grants and tokens; a row holds only
// what a listing shows, and none of the grant's secrets.
//
// A person whose grants were written before the rows is listed from KV once,
// and their rows written behind the answer beside `grants_listed` on their
// own row, which says from then on that their rows are whole.
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph'
import type { GrantSummary } from '@cloudflare/workers-oauth-provider'

/** An `oauth_grant` row: what a listing shows of one grant. Times are unix
 * seconds, as the provider keeps them; `until` is when KV lets the grant go
 * on its own (a consent's code not yet exchanged). */
export type Row = {
  person: string
  id: string
  client: string
  created: number
  redirect?: string
  name?: string
  scope?: string
  expires?: number
  until?: number
}

/** The directory as the rows need it: a person's rows, whether they are
 * whole (`listed`) and whether the directory holds the person at all
 * (`held`), and a write of rows. */
export type Book = {
  read: (
    person: string,
  ) => Promise<{ listed: boolean; held: boolean; rows: Row[] }>
  write: (bundles: Bundle[]) => Promise<unknown>
}

// The KV as the provider and this file ask of it.
type Kv = {
  get(key: string, as: { type: 'json' }): Promise<unknown>
  put(key: string, value: string, o?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(o: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number }[]
    list_complete: boolean
    cursor?: string
  }>
}

let PREFIX = 'grant:'

let keyed = (key: string) => {
  let [what, person, id, ...rest] = key.split(':')
  return what == 'grant' && person && id && !rest.length
    ? { person, id }
    : undefined
}

let eidOf = (id: string) => identityEid('oauth_grant', [id])

let seconds = (now: number) => Math.floor(now / 1000)

// A grant as the provider stores it, as its row.
let rowOf = (person: string, stored: unknown, until?: number): Row => {
  let g = stored as {
    id: string
    clientId: string
    createdAt: number
    redirectUri?: string
    metadata?: { client?: unknown }
    scope?: string[]
    expiresAt?: number
  }
  let name = g.metadata?.client
  return {
    person,
    id: g.id,
    client: g.clientId,
    created: g.createdAt,
    ...g.redirectUri ? { redirect: g.redirectUri } : {},
    ...typeof name == 'string' ? { name } : {},
    ...g.scope?.length ? { scope: g.scope.join(' ') } : {},
    ...g.expiresAt != null ? { expires: g.expiresAt } : {},
    ...until != null ? { until } : {},
  }
}

let bundleOf = (row: Row): Bundle => ({
  entity: { eid: eidOf(row.id) },
  oauth_grant: row,
})

// A grant's row gone, as KV's own grant went.
let unlisted = (id: string): Bundle => ({
  entity: { eid: eidOf(id) },
  oauth_grant: null,
})

/** The grant a row lists, as the provider summarizes one. */
let summary = (row: Row): GrantSummary => ({
  id: row.id,
  clientId: row.client,
  userId: row.person,
  scope: row.scope?.split(' ') ?? [],
  metadata: row.name == null ? {} : { client: row.name },
  createdAt: row.created,
  ...row.expires != null ? { expiresAt: row.expires } : {},
  ...row.redirect ? { redirectUri: row.redirect } : {},
})

/**
 * The KV the provider is handed: KV itself, but a grant put is first written
 * as its row and a grant deleted loses its row after, so the rows never miss
 * a grant KV holds. A write of the rows that fails fails the provider's, and
 * the person or client asks again.
 */
export let through = <T extends object>(
  kv: T,
  book: Pick<Book, 'write'>,
  now = Date.now,
): T => {
  let store = kv as unknown as Kv
  let put: Kv['put'] = async (key, value, o) => {
    let grant = keyed(key)
    if (grant) {
      let ttl = o?.expirationTtl
      let until = ttl ? seconds(now()) + ttl : undefined
      await book.write([
        bundleOf(rowOf(grant.person, JSON.parse(value), until)),
      ])
    }
    await store.put(key, value, o)
  }
  let gone: Kv['delete'] = async (key) => {
    await store.delete(key)
    let grant = keyed(key)
    if (grant) await book.write([unlisted(grant.id)])
  }
  return new Proxy(kv, {
    get: (target, name) => {
      if (name == 'put') return put
      if (name == 'delete') return gone
      let value = Reflect.get(target, name)
      return typeof value == 'function' ? value.bind(target) : value
    },
  })
}

// A person's grants read from KV, as rows, the way the provider lists them:
// every key under theirs, then each one read.
let fromKv = async (kv: Kv, person: string): Promise<Row[]> => {
  let prefix = `${PREFIX}${person}:`
  let keys: { name: string; expiration?: number }[] = []
  let cursor: string | undefined
  do {
    let page = await kv.list({ prefix, ...cursor ? { cursor } : {} })
    keys.push(...page.keys)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  let rows = await Promise.all(keys.map(async ({ name, expiration }) => {
    let stored = await kv.get(name, { type: 'json' })
    return stored ? rowOf(person, stored, expiration) : undefined
  }))
  return rows.filter((r) => r !== undefined)
}

/**
 * A person's grants, as connected.ts reads them: their rows, every one still
 * standing, in one page. A person whose rows are not yet whole is listed from
 * KV, and `behind` is handed the write of their rows and `grants_listed`,
 * for the caller to run past its answer; so is the removal of rows whose
 * grant KV has let go on its own (a code never exchanged). A person the
 * directory does not hold (one erased while their cookie still verifies) is
 * written nothing, so no listing brings their row back.
 */
export let listing = (
  kv: unknown,
  book: Book,
  behind: (work: () => Promise<unknown>) => void,
  now = Date.now,
) =>
async (person: string): Promise<{ items: GrantSummary[] }> => {
  let { listed, held, rows } = await book.read(person)
  if (!listed) rows = await fromKv(kv as Kv, person)
  if (!listed && held) {
    let whole = [
      ...rows.map(bundleOf),
      {
        entity: { eid: person },
        grants_listed: { at: new Date(now()).toISOString() },
      },
    ]
    behind(() => book.write(whole))
  }
  let at = seconds(now())
  let lapsed = rows.filter((r) => r.until != null && r.until <= at)
  if (listed && lapsed.length) {
    behind(() => book.write(lapsed.map((r) => unlisted(r.id))))
  }
  return {
    items: rows.filter((r) => !lapsed.includes(r)).map(summary),
  }
}
