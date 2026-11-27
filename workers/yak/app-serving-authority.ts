// Request admission follows the directory snapshot without moving behind a
// revision this app already accepted. Hosts supply persistence and transactions.
import { line, sub } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { type Mode, mode } from '@yaks/member'
import { EPOCH, FENCE_WAIT } from './directory-copy.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { ROUTE_MEMORY } from '@yaks/platform/route-memory'
import { VISIT, type Vouch, vouchOf } from '@yaks/platform/app-authority'
import { appAbout, type Row } from './directory.ts'
import { visitEdge, visitOfRow, visitorRole } from '@yaks/platform/visits'

type Word = 'name' | 'app' | 'space' | 'access' | 'mail' | 'phone' | 'policy'
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

// The access row follows the pair it belongs to: the app this store serves
// and that app's mode. A new app with the mode it already held (an erased
// app's store recovered under a new app row) is news for the row too, or the
// row stays on the app the store no longer serves and @yaks/member, reading
// the served app, finds none.
export let told = (
  news: Map<Word, string>,
  host: Pick<Host, 'read' | 'mode'>,
) => {
  let access = host.read('access')
  if (access && (news.has('app') || news.has('access'))) {
    host.mode(mode(access))
  }
}

export let servingAuthority = (host: Host) => {
  let learn = async (req: Request) => {
    let revision = policy(req)
    if (appMetadata(req) && (revision != null || host.copy())) {
      if (revision == null) {
        throw Object.assign(new Refused('Serving authorization unavailable'), {
          status: 503,
        })
      }
      let began = host.now()
      let memory = req.headers.get(ROUTE_MEMORY)
      let floor = Number(host.read('policy') ?? 0)
      let expired: { space: string | null } | undefined
      if (memory != null) {
        let app = host.read('app')
        if (app && app !== req.headers.get('x-yak-app')) {
          throw new Refused('app unavailable')
        }
        if (/^\d+$/.test(memory) && began < Number(memory)) {
          if (revision < floor) {
            // The remembered standing can answer this request. The Store's
            // current declaration and metadata still govern the Store.
            req.headers.delete('x-yak-release')
            return
          }
        } else {
          // A write kept in the log can land well after the kernel sent it.
          // Refresh its standing without carrying old metadata forward.
          expired = {
            space: req.headers.get('x-yak-space') ?? host.read('space'),
          }
          for (
            let header of [
              ROUTE_MEMORY,
              'x-yak-release',
              'x-yak-space',
              'x-yak-mail',
              'x-yak-phone',
              'x-yak-at',
            ]
          ) req.headers.delete(header)
          revision = await recheck(req, expired)
        }
      }
      while (revision < Number(host.read('policy') ?? 0)) {
        if (!host.directory() || host.now() - began >= FENCE_WAIT) {
          throw Object.assign(
            new Refused('Serving authorization unavailable'),
            {
              status: 503,
            },
          )
        }
        revision = await recheck(req, expired)
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
  // old role into a newly accepted revision. A stranger with no seat stands
  // by their browser's visit to the app (@yaks/platform/visits `visitorRole`).
  let recheck = async (
    req: Request,
    expired?: { space: string | null },
  ): Promise<number> => {
    let app = req.headers.get('x-yak-app') ?? host.read('app')
    let person = req.headers.get('x-yak-person')
    let via = req.headers.get('x-yak-via')
    let edge = via ? visitEdge(via, app!) : null
    // A query returns only what it names, and a visitor's standing is read from
    // the app's offer and its sample (@yaks/platform/visits `visitorRole`).
    let at = app ?? ''
    let itself = !!app && person === app
    let seat = person && !itself
      ? line`|.member.person=${person}&?member|.grant.app=${at}&.grant.person=${person}&?grant`
      : line``
    let visit = edge ? line`|.entity.eid=${edge}&?visit` : line``
    let definitionAt = line`.entity.eid=${at}&?app&?published&?demo`
    let live = expired
      ? line`(${sub(definitionAt)}&?trashed)${
        sub(
          expired.space
            ? line`|(.entity.eid=${expired.space}&?space&?trashed)`
            : line``,
        )
      }`
      : definitionAt
    let q = line`${sub(live)}${sub(seat)}${sub(visit)}`
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
    let row = rows.find((r) => r.entity.eid == app && r.app)
    let definition = row?.app as Comp | undefined
    if (!definition || definition.trashed || (expired && row?.trashed)) {
      throw new Refused('app unavailable')
    }
    let space = typeof definition.space == 'string'
      ? definition.space
      : (definition.space as { eid?: string } | undefined)?.eid
    if (
      expired?.space && (expired.space != space ||
        rows.some((r) => r.entity.eid == space && r.trashed))
    ) {
      throw new Refused('app unavailable')
    }
    let member = rows.find((r) => {
      let m = r.member as Comp | undefined
      let held = typeof m?.space == 'string'
        ? m.space
        : (m?.space as { eid?: string } | undefined)?.eid
      return held == space && !!m
    })?.member as Comp | undefined
    let grant = rows.find((r) => r.grant)?.grant as Comp | undefined
    let visitor = edge
      ? visitorRole(
        appAbout(row as Row),
        req.headers.get('x-store') ?? host.read('name'),
        visitOfRow(rows.find((r) => r.entity.eid == edge)?.visit as Comp),
      )
      : null
    // The kernel authenticated the app as itself. Its standing follows
    // the app's live row, since it has no seat in its own roster.
    let role = itself ? 'editor' : member?.role ?? grant?.access ?? visitor
    req.headers.set('x-yak-app', app!)
    if (expired && space) req.headers.set('x-yak-space', space)
    req.headers.set('x-yak-access', mode(definition.access))
    req.headers.set('x-yak-policy', raw)
    req.headers.delete('x-yak-role')
    req.headers.delete(VISIT)
    if (person || via) host.vouch({ ...vouchOf(req), level: null })
    if (
      (person || via) &&
      (role == 'owner' || role == 'editor' || role == 'viewer')
    ) {
      req.headers.set('x-yak-role', String(role))
    }
    if (visitor) req.headers.set(VISIT, '1')
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
        // The space it is in, the directory's word as well: whose connections
        // its chat messages may be posted by (chat.ts `appChatters`) and whose
        // number its texts leave from (app-texts.ts).
        ['space', req.headers.get('x-yak-space')],
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
    told(news, host)
  }
  return { learn, heard, recheck }
}
