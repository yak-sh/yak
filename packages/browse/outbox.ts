import { outboxIdb, type OutboxStore } from '@yaks/sync'
import type { Bundle } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import type { LegacyOutbox } from './legacy_outbox.ts'
import { bundlesOf } from './wire.ts'

// What a write on a page whose host names no person is told.
export let NOBODY =
  'This page is read-only: its graph names no person to write as'

// Cookie-authenticated pages cannot name a durable queue until the host has
// identified the person. Only writes wait on that lookup; watches open at once.
// A host with no person has no queue: nothing was ever saved for nobody, and a
// write is refused.
//
// `former` names a queue this page once wrote under a scope that named no
// person (@yaks/sync's default, before T-133002). Its writes are the owner's
// own: they load beside the owner's, replay under their own keys, and leave
// the former queue only when accepted or dismissed. Only a host whose writes
// can have one owner passes it.
export let scopedOutbox = (opts: {
  endpoint: string
  storage?: string
  owner: () => Promise<string | undefined>
  legacy?: LegacyOutbox
  former?: string
  open?: (scope: string) => OutboxStore<Bundle[]>
}): OutboxStore<Bundle[]> & { assertOwner: () => Promise<void> } => {
  let open = opts.open ?? outboxIdb<Bundle[]>
  let opening: Promise<OutboxStore<Bundle[]> | undefined> | undefined
  let formerly: OutboxStore<Bundle[]> | undefined
  let closed = false
  let scopedOwner: string | undefined
  let store = () =>
    opening ??= opts.owner().then((owner) => {
      if (closed) throw new Error('Outbox closed')
      scopedOwner = owner
      if (!owner) return undefined
      if (opts.former) formerly = open(opts.former)
      return open(JSON.stringify([opts.endpoint, opts.storage ?? '', owner]))
    })
  let writable = async () => {
    let opened = await store()
    if (!opened) throw new Refused(NOBODY)
    return opened
  }
  let loading:
    | Promise<Awaited<ReturnType<OutboxStore<Bundle[]>['load']>>>
    | undefined
  let load = () =>
    loading ??= (async () => {
      let destination = await store()
      if (!destination) return []
      let rows = await destination.load()
      for (let [id, old] of await opts.legacy?.load() ?? []) {
        let key = id.startsWith('outbox:') ? id : `outbox:${id}`
        let existing = rows.find((r) => r.key === key)
        let sent = bundlesOf(old.changes)
        if (
          existing && JSON.stringify(existing.sent) !== JSON.stringify(sent)
        ) {
          throw new Error('Legacy write key names different intent')
        }
        if (!existing) {
          let entry = {
            key,
            sent,
            state: 'pending' as const,
            at: old.at,
          }
          await destination.put(entry)
          rows.push(entry)
        }
        await opts.legacy!.remove(id)
      }
      for (let entry of await formerly?.load() ?? []) {
        if (!rows.some((r) => r.key === entry.key)) rows.push(entry)
      }
      return rows
    })()
  return {
    assertOwner: async () => {
      await writable()
      let owner = await opts.owner()
      if (owner !== scopedOwner) {
        throw new Error(
          'The authenticated write owner changed; reload to switch accounts',
        )
      }
    },
    load,
    put: async (entry) => (await writable()).put(entry),
    remove: async (key) => {
      await (await store())?.remove(key)
      await formerly?.remove(key)
    },
    close: () => {
      closed = true
      opts.legacy?.close?.()
      formerly?.close?.()
      void opening?.then((s) => s?.close?.(), () => {})
    },
  }
}
