/** A plain browser field on the same desk as every other draft interface. */
import { effect, signal } from '@preact/signals'
import type { Bundle } from '@yaks/graph'
import { desk, type DeskOpts, type Drafts, type Stash } from './desk.ts'
export { draftEid } from './desk.ts'

/** The published store client, without any platform implementation here. */
export type Store = {
  apply: (
    bundles: Bundle[],
  ) => Promise<{ bundles: Bundle[]; pending?: boolean }>
  me: () => Promise<{ person: string | null }>
  subscribe: (query: string, hear: (rows: Bundle[]) => void) => () => void
}
export type BrowserOpts = Pick<DeskOpts, 'pace' | 'report'> & {
  /** Supply identity when the page already knows it; otherwise ask me(). */
  by?: string
  /** A recovery copy, not the source of truth. false disables it. */
  stash?: Stash | false
}

// A person's pending text in one app must not become another app's draft.
let scoped = (storage: Stash, scope: string): Stash => {
  let prefix = `yaks:drafts:${scope}:`
  let keys = () =>
    Array.from({ length: storage.length }, (_, i) => storage.key(i))
      .filter((key): key is string => key != null && key.startsWith(prefix))
  return {
    get length() {
      return keys().length
    },
    key: (i) => keys()[i]?.slice(prefix.length) ?? null,
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  }
}

/** A durable desk with plain DOM bindings. */
export type BrowserDrafts = Drafts & {
  bind: (
    field: HTMLInputElement | HTMLTextAreaElement,
    place: string,
  ) => () => void
  close: () => void
}

/** Bind fields with one line; all merging, receipts and recovery belong to desk. */
export let browserDrafts = (
  client: Store,
  scope: string,
  opts: BrowserOpts = {},
): BrowserDrafts => {
  let report = opts.report ?? ((error: unknown) => {
    queueMicrotask(() => {
      throw error
    })
  })
  let closed = false
  let current = signal<ReturnType<typeof desk> | undefined>(undefined)
  let make = (by: string) => {
    if (closed) return
    let stash: Stash | undefined
    try {
      let storage = opts.stash === false
        ? undefined
        : opts.stash ?? globalThis.localStorage
      if (storage) stash = scoped(storage, `${scope}|${by}`)
    } catch (error) {
      report(error)
    }
    current.value = desk({
      mutate: async (bundles) => {
        let receipt = await client.apply(bundles)
        if (receipt.pending) {
          throw new Error('The store has not confirmed this draft yet')
        }
        return receipt.bundles
      },
      watch: (query) => {
        let value: Bundle[] = []
        let listeners = new Set<(rows: Bundle[]) => void>()
        let close = client.subscribe(query, (rows) => {
          value = rows
          for (let hear of listeners) hear(rows)
        })
        return {
          get value() {
            return value
          },
          subscribe: (hear: (rows: Bundle[]) => void) => {
            listeners.add(hear)
            return () => {
              listeners.delete(hear)
            }
          },
          close,
        }
      },
    }, { by: () => by, stash, pace: opts.pace, report })
  }
  // Never open another person's recovery copy, nor spend without identity.
  // A bound field is briefly read-only until me answers, not an editable field
  // whose first keystrokes can disappear before it is safe to persist them.
  let ready: Promise<void>
  if (opts.by) {
    make(opts.by)
    ready = Promise.resolve()
  } else {ready = client.me().then((me) => {
      if (me.person) make(me.person)
    }).catch(report)}
  let drafts = () => {
    let d = current.value
    if (!d || closed) throw new Error('Draft identity is not ready')
    return d
  }
  let bindings = new Set<() => void>()
  return {
    text: (place: string) => current.value?.text(place) ?? '',
    type: (place: string, text: string) => drafts().type(place, text),
    restore: (place: string, text: string, over?: string) =>
      drafts().restore(place, text, over),
    spend: async (place: string, also: Bundle[] = []) => {
      await ready
      if (!current.value || closed) return false
      return current.value.spend(place, also)
    },
    /** Stop before replacing a field; rebind its replacement to the same place. */
    bind: (field: HTMLInputElement | HTMLTextAreaElement, place: string) => {
      let composing = false
      let readOnly = field.readOnly
      let show = () => {
        let d = current.value
        field.readOnly = !d || readOnly
        if (!d) return
        let text = d.text(place)
        if (!composing && field.value !== text) {
          let start = field.selectionStart, end = field.selectionEnd
          field.value = text
          if (start != null && end != null) field.setSelectionRange(start, end)
        }
      }
      let stop = effect(show)
      let input = () => {
        current.value?.type(place, field.value)
      }
      let begin = () => {
        composing = true
      }
      let end = () => {
        composing = false
        input()
        show()
      }
      field.addEventListener('input', input)
      field.addEventListener('compositionstart', begin)
      field.addEventListener('compositionend', end)
      let unbind = () => {
        stop()
        field.readOnly = readOnly
        field.removeEventListener('input', input)
        field.removeEventListener('compositionstart', begin)
        field.removeEventListener('compositionend', end)
        bindings.delete(unbind)
      }
      bindings.add(unbind)
      return unbind
    },
    close: () => {
      closed = true
      for (let unbind of bindings) unbind()
      current.value?.close()
    },
  }
}
