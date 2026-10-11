// Unsent commands belong to the person in the app store. Choices and carets
// last only as long as this page; the old browser vault is drained on receipt.
import { effect, signal, untracked } from '@preact/signals'
import { idb, type Saved, type Vault } from '@yaks/client'
import { desk, draftEid, type Drafts, type Stash } from '@yaks/draft'
import { completion, type Opts } from '@yaks/ux/completion'
import type { Net } from './net.ts'

export type CommandFieldOpts = {
  vault?: Vault | false
  stash?: Stash
  pace?: number
  report?: (err: unknown) => void
}

// Only server acknowledgement clears the emergency stash. Namespace its
// places by app and account, including while the old vault is being drained.
let scoped = (store: Stash, by: string, app: string): Stash => {
  let prefix = `vale:commands:${encodeURIComponent(app)}:${
    encodeURIComponent(by)
  }:`
  let keys = () =>
    Array.from({ length: store.length }, (_, i) => store.key(i))
      .filter((key): key is string => !!key?.startsWith(prefix))
  return {
    get length() {
      return keys().length
    },
    key: (i) => keys()[i]?.slice(prefix.length) ?? null,
    getItem: (key) => store.getItem(prefix + key),
    setItem: (key, value) => store.setItem(prefix + key, value),
    removeItem: (key) => store.removeItem(prefix + key),
  }
}

export let commandField = (
  net: Pick<Net, 'client'> & { store?: string },
  by: () => string | null | undefined,
  complete: Opts['complete'],
  opts: CommandFieldOpts = {},
) => {
  let local = net.client
  // Kept pages still use this vault. Import its rows without rewriting them,
  // and forget each source only after the app store has taken its text.
  let vault = opts.vault === false ? undefined : opts.vault ??
    (typeof indexedDB == 'undefined'
      ? undefined
      : idb({ name: 'vale-command-field' }))
  let legacy = new Map<string, Saved>()
  let report = opts.report ?? ((err: unknown) => console.warn(err))
  let store = opts.stash
  if (!store) {
    try {
      store = globalThis.localStorage
    } catch (err) {
      report(err)
    }
  }
  // A denied browser stash still permits migration and keeps pending text in
  // memory; the old vault remains durable until its hosted write is accepted.
  if (!store) {
    let rows = new Map<string, string>()
    store = {
      get length() {
        return rows.size
      },
      key: (i) => [...rows.keys()][i] ?? null,
      getItem: (key) => rows.get(key) ?? null,
      setItem: (key, value) => void rows.set(key, value),
      removeItem: (key) => void rows.delete(key),
    }
  }
  let enabled = signal(false)
  let active = signal<ReturnType<typeof desk> | undefined>(undefined)
  let desks = new Map<string, ReturnType<typeof desk>>()
  let closed = false
  let drafts: Drafts = {
    text: (place) => active.value?.text(place) ?? '',
    type: (place, text) => {
      if (!closed) active.value?.type(place, text)
    },
    spend: (place, also) =>
      closed
        ? Promise.resolve(false)
        : active.value?.spend(place, also) ?? Promise.resolve(false),
    restore: (place, text, over) => {
      if (!closed) active.value?.restore(place, text, over)
    },
  }
  let fields = completion({
    watch: local.watch,
    ent: local.ent,
    mutate: (bundles) => closed ? [] : local.mutate(bundles),
  }, { complete, drafts })
  let owner: string | null | undefined
  let stop = effect(() => {
    let next = enabled.value ? by() : undefined
    untracked(() => {
      if (next == owner) return
      // Invalidate answers still arriving for the previous person's input.
      // Leave empty state rows so bound inputs also clear on sign-out.
      let rows = local.read('.Completion')
      for (let row of rows) fields.dismiss(row.entity.eid)
      local.mutate(rows.map(({ entity }) => ({
        entity,
        Completion: { caret: 0, from: 0, to: 0, cands: [], pick: 0 },
      })))
      owner = next
      let d = next ? desks.get(next) : undefined
      if (next && !d) {
        let account = next
        let stash = scoped(store!, account, net.store ?? 'vale')
        let represented = new Map<string, Saved>()
        let oldPrefix = `vale:commands:${encodeURIComponent(account)}:`
        let emergency = new Map<string, { key: string; value: string }>()
        d = desk({
          watch: net.client.watch,
          // desk may finish an in-flight acknowledgement after close. It
          // must not start another graph write or recreate a closed watch.
          mutate: async (bundles) => {
            if (closed) return []
            let sources = new Map(bundles.flatMap((b) => {
              let row = represented.get(b.entity.eid)
              return b.draft && row ? [[b.entity.eid, row] as const] : []
            }))
            let copies = new Map(bundles.flatMap((b) => {
              let copy = emergency.get(b.entity.eid)
              return b.draft && copy ? [[b.entity.eid, copy] as const] : []
            }))
            let applied = await net.client.mutate(bundles)
            let moved = applied.flatMap((b) => {
              let row = sources.get(b.entity.eid)
              return b.draft && row ? [row] : []
            })
            if (moved.length) {
              try {
                if (!vault?.take) {
                  throw new Error(
                    'Legacy draft vault cannot atomically drain snapshots',
                  )
                }
                let changed = await vault.take(moved)
                for (let row of moved) {
                  legacy.delete(row.eid)
                  represented.delete(row.eid)
                }
                for (let row of changed) {
                  let old = moved.find((source) => source.eid == row.eid)!
                  legacy.set(row.eid, row)
                  represented.set(row.eid, row)
                  if (!closed && typeof row.comps.draft?.place == 'string') {
                    d?.restore(
                      row.comps.draft.place,
                      String(row.comps.draft.text ?? ''),
                      String(old.comps.draft?.text ?? ''),
                    )
                  }
                }
              } catch (err) {
                report(err)
              }
            }
            try {
              for (let b of applied) {
                let copy = copies.get(b.entity.eid)
                if (!b.draft || !copy) continue
                let current = store!.getItem(copy.key)
                if (current == copy.value) {
                  store!.removeItem(copy.key)
                  emergency.delete(b.entity.eid)
                } else if (current && !closed) {
                  let old = JSON.parse(copy.value), newer = JSON.parse(current)
                  emergency.set(b.entity.eid, { key: copy.key, value: current })
                  d?.restore(
                    copy.key.slice(oldPrefix.length + 'draft:'.length),
                    newer.text,
                    old.text,
                  )
                }
              }
            } catch (err) {
              report(err)
            }
            return applied
          },
        }, {
          by: () => closed ? undefined : account,
          stash,
          pace: opts.pace,
          report,
        })
        desks.set(next, d)
        for (let row of legacy.values()) {
          let draft = row.comps.draft
          if (
            draft?.by != account || typeof draft.place != 'string' ||
            !draft.text
          ) continue
          let kept = stash.getItem(`draft:${draft.place}`)
          let over = kept ? String(JSON.parse(kept).over ?? '') : ''
          represented.set(row.eid, row)
          d.restore(draft.place, String(draft.text), over)
        }
        for (let i = 0; i < store!.length; i++) {
          let key = store!.key(i)
          if (!key?.startsWith(oldPrefix + 'draft:')) continue
          let value = store!.getItem(key)!
          try {
            let kept = JSON.parse(value)
            let place = key.slice(oldPrefix.length + 'draft:'.length)
            emergency.set(draftEid(account, place), { key, value })
            d.restore(place, String(kept.text ?? ''), String(kept.over ?? ''))
          } catch (err) {
            report(err)
          }
        }
      }
      active.value = d
    })
  })
  // Binding before import finishes cannot overwrite a precious saved draft.
  let ready = Promise.all([local.ready, vault?.load()]).then(([, rows]) => {
    for (let row of rows ?? []) legacy.set(row.eid, row)
    if (!closed) enabled.value = true
  })
  let close = () => {
    if (closed) return
    closed = true
    stop()
    for (let d of desks.values()) d.close()
    fields.dispose()
  }
  return { fields, drafts, ready, close }
}
