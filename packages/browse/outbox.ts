import { outboxIdb, type OutboxStore } from '@yaks/sync'
import type { Bundle } from '@yaks/graph'
import type { LegacyOutbox } from './legacy_outbox.ts'
import { bundlesOf } from './wire.ts'

// Cookie-authenticated pages cannot name a durable queue until the host has
// identified the person. Only writes wait on that lookup; watches open at once.
export let scopedOutbox = (opts: {
  endpoint: string
  storage?: string
  owner: () => Promise<string | undefined>
  legacy?: LegacyOutbox
  open?: (scope: string) => OutboxStore<Bundle[]>
}): OutboxStore<Bundle[]> & { assertOwner: () => Promise<void> } => {
  let opening: Promise<OutboxStore<Bundle[]>> | undefined
  let closed = false
  let scopedOwner: string
  let store = () =>
    opening ??= opts.owner().then((owner) => {
      if (!owner) {
        throw new Error('Cannot save writes without an authenticated owner')
      }
      if (closed) throw new Error('Outbox closed')
      scopedOwner = owner
      return (opts.open ?? outboxIdb<Bundle[]>)(
        JSON.stringify([opts.endpoint, opts.storage ?? '', owner]),
      )
    })
  let loading:
    | Promise<Awaited<ReturnType<OutboxStore<Bundle[]>['load']>>>
    | undefined
  let load = () =>
    loading ??= (async () => {
      let destination = await store()
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
      return rows
    })()
  return {
    assertOwner: async () => {
      await store()
      let owner = await opts.owner()
      if (!owner || owner !== scopedOwner) {
        throw new Error(
          'The authenticated write owner changed; reload to switch accounts',
        )
      }
    },
    load,
    put: async (entry) => (await store()).put(entry),
    remove: async (key) => (await store()).remove(key),
    close: () => {
      closed = true
      opts.legacy?.close?.()
      void opening?.then((s) => s.close?.(), () => {})
    },
  }
}
