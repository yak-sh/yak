// Commands keep their drafts in the vale's own browser vault, not the world
// connection. Choices and carets last only as long as this page does.
import { effect, signal, untracked } from '@preact/signals'
import { client, idb, type Vault } from '@yaks/client'
import {
  desk,
  draftDoc,
  type Drafts,
  drafts as draftPlugin,
  type Stash,
} from '@yaks/draft'
import { completion, type Opts } from '@yaks/ux/completion'
import { uxDoc } from '@yaks/ux/vocab'
import { loadVocab } from '@yaks/vocab'
import type { Net } from './net.ts'

export type CommandFieldOpts = {
  vault?: Vault | false
  stash?: Stash
  pace?: number
  report?: (err: unknown) => void
}

// desk's emergency stash is cleared on acknowledgement. The vault, not this
// stash, keeps acknowledged drafts. Namespace its places by app and account.
let scoped = (store: Stash, by: string): Stash => {
  let prefix = `vale:commands:${encodeURIComponent(by)}:`
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
  _net: Pick<Net, 'client'>,
  by: () => string | null | undefined,
  complete: Opts['complete'],
  opts: CommandFieldOpts = {},
) => {
  let doc = structuredClone(draftDoc)
  let defs = doc.$defs!
  defs.draft.sync = 'none'
  defs.draft.durable = 'forever'
  defs.typed.sync = 'none'
  defs.typed.durable = '0s'
  let plugin = draftPlugin()
  let local = client(loadVocab([uxDoc, doc]), [{ ...plugin, vocab: [doc] }], {
    vault: opts.vault ??
      (typeof indexedDB == 'undefined'
        ? false
        : idb({ name: 'vale-command-field' })),
    wireVault: false,
    signal,
  })
  let report = opts.report ?? ((err: unknown) => console.warn(err))
  let store = opts.stash
  if (!store) {
    try {
      store = globalThis.localStorage
    } catch (err) {
      report(err)
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
    spend: (place, also) => {
      if (!closed) active.value?.spend(place, also)
    },
  }
  let fields = completion({
    watch: local.watch,
    ent: local.ent,
    mutate: (change) => closed ? [] : local.mutate(change),
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
        d = desk({
          watch: local.watch,
          // desk may finish an in-flight acknowledgement after close. It
          // must not start another graph write or recreate a closed watch.
          mutate: (change) => closed ? [] : local.mutate(change),
        }, {
          by: () => closed ? undefined : account,
          stash: store ? scoped(store, account) : undefined,
          pace: opts.pace,
          report,
        })
        desks.set(next, d)
      }
      active.value = d
    })
  })
  // Binding before ready can establish transient caret state, but cannot
  // type an empty draft over the vault's still-loading text.
  let ready = local.ready.then(() => {
    if (!closed) enabled.value = true
  })
  let close = () => {
    if (closed) return
    closed = true
    stop()
    for (let d of desks.values()) d.close()
    fields.dispose()
    local.close()
  }
  return { fields, drafts, ready, close }
}
