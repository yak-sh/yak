/** A plain browser field on the same desk as every other draft interface. */
import { effect, signal } from '@preact/signals'
import type { Bundle } from '@yaks/graph'
import { desk, type DeskOpts, type Drafts, type Stash } from './desk.ts'
import { merge } from './merge.ts'
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
  /** Earlier principals vouched by this host, such as this browser's guest
   * instrument after sign-in. Their pending text moves before it is removed. */
  recover?: string[]
  /** A recovery copy, not the source of truth. false disables it. */
  stash?: Stash | false
}

type Copy = { text: string; over: string; rev: number }
type Copies = Record<string, Copy>
let prefix = (scope: string, by: string) => `yaks:drafts:${scope}|${by}:`
let keys = (storage: Stash) =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key): key is string => key != null)
let copies = (value: string | null, by: string): Copies => {
  if (value == null) return {}
  let parsed = JSON.parse(value)
  return parsed.pending ?? { [by]: parsed }
}
let combined = (a: Copy | undefined, b: Copy): Copy =>
  a ? { ...a, text: merge(b.over, b.text, a.text) } : b
let stored = (storage: Stash, key: string, pending: Copies) => {
  if (!Object.keys(pending).length) return storage.removeItem(key)
  let value = JSON.stringify({ pending })
  storage.setItem(key, value)
  if (storage.getItem(key) !== value) {
    throw new Error('Recovered draft was not retained')
  }
}

// Ownership belongs to each pending input. A handoff changes its owner in the
// same recovery value; no second copy must succeed before it becomes private.
let adopted = (storage: Stash, scope: string, from: string, by: string) => {
  let start = prefix(scope, from)
  for (let key of keys(storage)) {
    if (!key.startsWith(start + 'draft:')) continue
    let pending = copies(storage.getItem(key), from)
    if (!pending[from]) continue
    pending[by] = combined(pending[by], pending[from])
    delete pending[from]
    stored(storage, key, pending)
  }
}

// The desk sees only its owner's copies, including ones still kept at a
// vouched guest location. A fresh guest can type in the same place without
// replacing another person's pending input there.
let scoped = (
  storage: Stash,
  scope: string,
  by: string,
  recover: string[],
): Stash => {
  let start = `yaks:drafts:${scope}|`
  let owned = keys(storage).flatMap((key) => {
    if (!key.startsWith(start)) return []
    let origin = key.slice(start.length).split(':')[0]
    return copies(storage.getItem(key), origin)[by] ? [origin] : []
  })
  let origins = [...new Set([by, ...recover, ...owned])]
  let locations = (key: string) =>
    origins.map((origin) => ({ origin, key: prefix(scope, origin) + key }))
  let read = (key: string) => {
    let text: Copy | undefined
    for (let location of locations(key)) {
      let pending = copies(storage.getItem(location.key), location.origin)
      if (pending[by]) text = combined(text, pending[by])
    }
    return text
  }
  let visible = () => {
    let found = new Set<string>()
    for (let key of keys(storage)) {
      for (let origin of origins) {
        let start = prefix(scope, origin)
        if (key.startsWith(start) && read(key.slice(start.length))) {
          found.add(key.slice(start.length))
        }
      }
    }
    return [...found]
  }
  let remove = (key: string, except?: string) => {
    for (let location of locations(key)) {
      if (location.key === except) continue
      let pending = copies(storage.getItem(location.key), location.origin)
      if (!pending[by]) continue
      delete pending[by]
      stored(storage, location.key, pending)
    }
  }
  return {
    get length() {
      return visible().length
    },
    key: (i) => visible()[i] ?? null,
    getItem: (key) => {
      let value = read(key)
      return value ? JSON.stringify(value) : null
    },
    setItem: (key, value) => {
      let places = locations(key)
      let target =
        places.find((place) =>
          copies(storage.getItem(place.key), place.origin)[by]
        ) ?? places[0]
      let pending = copies(storage.getItem(target.key), target.origin)
      pending[by] = JSON.parse(value)
      stored(storage, target.key, pending)
      remove(key, target.key)
    },
    removeItem: (key) => remove(key),
  }
}

/** A durable desk with plain DOM bindings. */
export type BrowserDrafts = Drafts & {
  bind: (
    field: HTMLInputElement | HTMLTextAreaElement,
    place: string,
  ) => () => void
  /** Settles once the person is known and their drafts may be typed. */
  ready: Promise<void>
  /** Run `fn` now and again whenever a text, place or identity it read
   * changes, until the returned function is called. */
  follow: (fn: () => void) => () => void
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
      if (storage) {
        let recover = opts.recover ?? []
        for (let previous of recover) {
          if (previous !== by) adopted(storage, scope, previous, by)
        }
        stash = scoped(storage, scope, by, recover)
      }
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
    has: (place: string) => current.value?.has(place) ?? false,
    places: () => current.value?.places() ?? [],
    ready,
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
    follow: (fn: () => void) => {
      let stop = effect(fn)
      bindings.add(stop)
      return () => {
        stop()
        bindings.delete(stop)
      }
    },
    close: () => {
      closed = true
      for (let unbind of bindings) unbind()
      current.value?.close()
    },
  }
}
