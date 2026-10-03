#!/usr/bin/env -S deno run -A
// One-time D-64656 migration. Run only with an explicitly chosen config and
// state directory: deno run -A bin/migrate-admin-sessions.ts --config copy.json --state copy-state
// Rehearse on a database AND vault copy; this script never copies either itself.
import { authorize, credential } from '@yaks/connections'
import { yaksApp } from '@yaks/connections/yaks-app'
import type { Authorization } from '../packages/connections/authorize.ts'
import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  token,
} from '@yaks/graph'
import type { Sealed, Vault } from '@yaks/secrets'

const PREFIX = 'yaks.app session '
const part = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp
const account = (value: unknown) => String(value ?? '').toLowerCase()

export type MigrationHost = {
  graph: Graph
  vault: Vault
  owner: Eid
  /** Remove only the explicitly selected state's current.yaks.app; false if absent. */
  clearCurrent: () => boolean | Promise<boolean>
}
export type MigrationOptions = {
  /** Pure test seam; production always uses authorize + yaksApp's held session. */
  authorization?: (session: string) => Authorization
  bearer?: (connection: Eid) => Promise<string | undefined>
}
export type MigrationReport = {
  found: number
  authorized: number
  reused: number
  deleted: number
  failed: number
  remaining: number
  currentRemoved: boolean
}

/** Counts only: never return a cookie, bearer, callback, handle or exception text.
 * A failed row remains retriable. A completed connection is checked before the
 * source is removed, including after a crash between those two writes. */
export let migrateAdminSessions = async (
  h: MigrationHost,
  options: MigrationOptions = {},
): Promise<MigrationReport> => {
  let sources = async () => {
    let rows = (await h.graph.read('.secret&*')).filter((b) =>
      String(part(b, 'secret').name ?? '').startsWith(PREFIX)
    )
    let held = (await h.vault.all()).filter(([, s]) =>
      s.name?.startsWith(PREFIX)
    )
    // An orphaned vault value is a failure, not a reason to forget current.
    return {
      rows,
      held,
      ids: [
        ...new Set([
          ...rows.map((b) => b.entity.eid),
          ...held.map(([id]) => id),
        ]),
      ],
    }
  }
  let report: MigrationReport = {
    found: 0,
    authorized: 0,
    reused: 0,
    deleted: 0,
    failed: 0,
    remaining: 0,
    currentRemoved: false,
  }
  let authorization = options.authorization ??
    ((session) => authorize(h, yaksApp(h, { session })))
  let bearer = options.bearer ?? ((connection) => credential(h, connection))
  let initial = await sources()
  report.found = initial.ids.length
  let saved = (b: Bundle, s: Sealed | undefined) =>
    !!s && s.name == part(b, 'secret').name &&
    s.handle == part(b, 'secret').value && !b.provisional && !b.exception
  let verified = async (address: string, session: string) => {
    let candidates = (await h.graph.read('.connection&*')).filter((b) => {
      let c = part(b, 'connection')
      return c.owner == h.owner && c.integration == 'yaks.app' &&
        c.status == 'connected' && account(c.account) == account(address)
    })
    for (let b of candidates) {
      let matches = async () => {
        let [now] = await h.graph.get([b.entity.eid])
        let s = await h.vault.read(b.entity.eid)
        if (!now || !saved(now, s) || !s?.value) return false
        let c = part(now, 'connection')
        if (
          c.owner != h.owner || c.integration != 'yaks.app' ||
          c.status != 'connected' || account(c.account) != account(address)
        ) return false
        let value: unknown
        try {
          value = JSON.parse(s.value)
        } catch {
          return false
        }
        if (!value || typeof value != 'object' || Array.isArray(value)) {
          return false
        }
        let t = value as Record<string, unknown>
        return t.website_session === session &&
          typeof t.access_token == 'string' && !!t.access_token
      }
      if (!await matches()) continue
      // Ordinary credential validation refreshes an expired grant rather than
      // needlessly authorizing it again. Re-read the durable record afterwards.
      if (await bearer(b.entity.eid) && await matches()) return true
    }
    return false
  }
  for (let eid of initial.ids) {
    try {
      await h.vault.lock(eid, async () => {
        let [source] = await h.graph.get([eid])
        let kept = await h.vault.read(eid)
        if (!source || !saved(source, kept) || !kept?.value) {
          throw new Error('source unavailable')
        }
        let name = String(part(source, 'secret').name)
        let address = name.slice(PREFIX.length), session = kept.value
        if (!name.startsWith(PREFIX) || !address.includes('@')) {
          throw new Error('source invalid')
        }
        if (await verified(address, session)) report.reused++
        else {
          let auth = authorization(session)
          try {
            await auth.run('begin', 'yaks.app', undefined, address)
            if (!auth.returned?.('yaks.app')) {
              throw new Error('no automatic return')
            }
            await auth.run('complete', 'yaks.app')
            report.authorized++
          } finally {
            await auth.close()
          }
          if (!await verified(address, session)) {
            throw new Error('credential not confirmed')
          }
        }
        // Rotation preserves a handle, so compare the value too under its lock.
        let latest = await h.vault.read(eid)
        if (
          latest?.value !== session || latest.name != name ||
          latest.handle != kept.handle
        ) {
          throw new Error('source moved')
        }
        await h.graph.apply([{
          entity: { eid },
          secret: null,
          $was: { secret: { name: token(name), value: token(kept.handle) } },
        }])
        if ((await h.graph.get([eid]))[0]?.secret || await h.vault.read(eid)) {
          throw new Error('source deletion incomplete')
        }
        report.deleted++
      })
    } catch {
      // Auth/network/vault errors can contain private data. Counts are sufficient;
      // source rows remain the durable retry queue, not an exception log.
      report.failed++
    }
  }
  report.remaining = (await sources()).ids.length
  if (!report.failed && !report.remaining) {
    try {
      report.currentRemoved = await h.clearCurrent()
    } catch {
      report.failed++
    }
  }
  return report
}

/** No config discovery, environment fallback, or implicit live state directory. */
export let migrationArgs = (
  args: string[],
): { config: string; state: string } => {
  let values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    let key = args[i], value = args[i + 1]
    if (
      !['--config', '--state'].includes(key) || !value ||
      value.startsWith('--') || values.has(key)
    ) {
      throw new Error(
        'usage: --config <path> --state <directory> (both required)',
      )
    }
    values.set(key, value)
  }
  if (!values.has('--config') || !values.has('--state')) {
    throw new Error(
      'usage: --config <path> --state <directory> (both required)',
    )
  }
  return { config: values.get('--config')!, state: values.get('--state')! }
}

if (import.meta.main) {
  try {
    let args = migrationArgs(Deno.args)
    let { read } = await import('../packages/cli/config.ts')
    let { compose, person } = await import('@yaks/cli/host')
    let config = read(args.config)
    if (!config.db || !config.person) {
      throw new Error('explicit database and person required')
    }
    let host = await compose(
      { ...config, duties: false },
      ['graph'],
      undefined,
      { process: false },
    )
    try {
      let owner = await person(host)
      if (!owner) throw new Error('person required')
      let report = await migrateAdminSessions({
        graph: host.graph,
        vault: host.vault,
        owner,
        clearCurrent: async () => {
          try {
            await Deno.remove(`${args.state}/current.yaks.app`)
            return true
          } catch (e) {
            if (e instanceof Deno.errors.NotFound) return false
            throw e
          }
        },
      })
      console.log(JSON.stringify(report))
      if (report.failed || report.remaining) Deno.exitCode = 1
    } finally {
      await host.close()
    }
  } catch {
    console.error(
      'Migration could not finish. Supply --config <path> --state <directory>; source secrets and current state are retained on failure. No credentials reported.',
    )
    Deno.exitCode = 1
  }
}
