// Request admission follows the directory snapshot without moving behind a
// revision this app already accepted. Hosts supply persistence and transactions.
import type { Bundle, Comp } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { type Mode, mode } from '@yaks/member'
import { EPOCH, FENCE_WAIT } from './directory-copy.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { type Vouch, vouchOf } from './app-authority.ts'

type Word = 'name' | 'app' | 'access' | 'mail' | 'phone' | 'policy'
type Host = {
  read(key: Word): string | null
  write(key: Word, value: string): void
  copy(): unknown
  directory(): unknown
  now(): number
  transport(): { fetch(request: Request): Promise<Response> }
  vouch(value: Vouch): void
  atomic(run: () => void): void
  bind(): void
  mode(value: Mode): void
}

export let servingAuthority = (host: Host) => {
  let learn = async (req: Request) => {
    let revision = policy(req)
    if (appMetadata(req) && host.copy()) {
      if (revision == null) {
        throw Object.assign(new Refused('Serving authorization unavailable'), {
          status: 503,
        })
      }
      let began = host.now()
      while (revision < Number(host.read('policy') ?? 0)) {
        if (!host.directory() || host.now() - began >= FENCE_WAIT) {
          throw Object.assign(
            new Refused('Serving authorization unavailable'),
            {
              status: 503,
            },
          )
        }
        revision = await recheck(req)
      }
    }
    // Reject outside the transaction: that helper treats a failure as a broken schema.
    // No yield separates this check from the synchronous transaction below.
    policyFloor(req)
    // The authority check yields. Recheck the local floor inside remember:
    // another request may have accepted a newer revision while it was away.
    // An equal persisted revision with unchanged metadata has nothing to write.
    if (
      heard(req).length ||
      (revision != null && host.read('policy') != String(revision))
    ) {
      host.atomic(() => remember(req))
    } else if (appMetadata(req) && host.read('policy') != null) {
      remember(req)
    }
  }

  // Reread metadata and standing in one directory snapshot; never carry an
  // old role into a newly accepted revision.
  let recheck = async (req: Request): Promise<number> => {
    let app = req.headers.get('x-yak-app') ?? host.read('app')
    let person = req.headers.get('x-yak-person')
    let q = `.entity.eid=${app}&?app`
    if (person) {
      q +=
        `|.member.person=${person}&?member|.grant.app=${app}&.grant.person=${person}&?grant`
    }
    let answer = await host.transport().fetch(
      new Request(`http://directory/query?q=${encodeURIComponent(q)}`),
    )
    let raw = answer.headers.get(EPOCH)
    if (!answer.ok || raw == null || !/^\d+$/.test(raw)) {
      throw Object.assign(new Refused('Serving authorization unavailable'), {
        status: 503,
      })
    }
    let rows: Bundle[] = await answer.json()
    let definition = rows.find((r) => r.entity.eid == app)?.app as
      | Comp
      | undefined
    if (!definition || definition.trashed) throw new Refused('app unavailable')
    let space = typeof definition.space == 'string'
      ? definition.space
      : (definition.space as { eid?: string } | undefined)?.eid
    let member = rows.find((r) => {
      let m = r.member as Comp | undefined
      let held = typeof m?.space == 'string'
        ? m.space
        : (m?.space as { eid?: string } | undefined)?.eid
      return held == space && !!m
    })?.member as Comp | undefined
    let grant = rows.find((r) => r.grant)?.grant as Comp | undefined
    let role = member?.role ?? grant?.access
    req.headers.set('x-yak-app', app!)
    req.headers.set('x-yak-access', mode(definition.access))
    req.headers.set('x-yak-policy', raw)
    req.headers.delete('x-yak-role')
    if (person) host.vouch({ ...vouchOf(req), level: null })
    if (person && (role == 'owner' || role == 'editor' || role == 'viewer')) {
      req.headers.set('x-yak-role', String(role))
    }
    return Number(raw)
  }

  let appMetadata = (req: Request): boolean => {
    return (req.headers.get('x-store') ?? host.read('name')) !=
        PLATFORM_STORE &&
      ['x-yak-app', 'x-yak-access', 'x-yak-mail', 'x-yak-policy'].some((h) =>
        req.headers.has(h)
      )
  }

  let policy = (req: Request): number | null => {
    if (!appMetadata(req)) return null
    let raw = req.headers.get('x-yak-policy')
    if (raw == null) return null
    let revision = /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw Object.assign(
        new Refused('Invalid serving authorization revision'),
        { status: 503 },
      )
    }
    return revision
  }

  let heard = (req: Request): [Word, string][] => {
    let name = req.headers.get('x-store')
    let said: [Word, string | null][] = [['name', name]]
    if ((name ?? host.read('name')) != PLATFORM_STORE) {
      said.push(
        ['app', req.headers.get('x-yak-app')],
        ['access', req.headers.get('x-yak-access')],
        // The address this app's letters leave from (directory.ts `mailbox`).
        // Like the access mode it is the directory's word and is followed
        // rather than argued with — an app renamed, or made the space's front
        // page, writes from its new address on the very next request. Nothing
        // is rebuilt for it: `#posting` reads the word at write time.
        ['mail', req.headers.get('x-yak-mail')],
        // The app's own number, the same way: the directory's word, read at
        // send time (app-texts.ts). Empty is a word too, the number taken
        // away, which sends the app's texts back to its pilot.
        ['phone', req.headers.get('x-yak-phone')],
      )
    }
    return said.filter((s): s is [Word, string] =>
      s[1] != null && (!!s[1] || s[0] == 'phone') && s[1] != host.read(s[0])
    )
  }

  let policyFloor = (req: Request) => {
    let revision = policy(req)
    let floor = host.read('policy')
    if (
      appMetadata(req) && floor != null &&
      (revision == null || revision < Number(floor))
    ) {
      throw Object.assign(new Refused('Stale serving authorization'), {
        status: 503,
      })
    }
  }

  let remember = (req: Request) => {
    policyFloor(req)
    let revision = policy(req)
    let floor = host.read('policy')
    // No metadata, mode or person vouch may be installed before this check.
    if (revision != null && (floor == null || revision > Number(floor))) {
      host.write('policy', String(revision))
    }
    let news = new Map(heard(req))
    for (let [k, v] of news) host.write(k, v)
    // The name is what says whether this object is the directory, so learning
    // it for the first time can change which vocabulary it speaks — and the
    // object was constructed before any request could tell it. The app it
    // holds is what its guard asks about. Either is one rebuild, however many
    // of them a request said.
    if (news.has('name') || news.has('app')) host.bind()
    let access = news.get('access')
    if (access) host.mode(mode(access))
  }
  return { learn, heard, recheck }
}
