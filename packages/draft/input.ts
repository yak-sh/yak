// The interface's drafts and the boxes that type into them. A host supplies
// its watch/write doors, identity and storage; no draft knows its app.
import { signal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import { type Client, desk, type Drafts, type Stash } from './desk.ts'

export type DraftHost = {
  client: Client
  by: () => string | undefined
  people: () => Promise<Bundle[]>
  stash: () => Stash | undefined
}
let host: DraftHost | undefined
let only = signal<string | undefined>()
let bound: ReturnType<typeof desk> | undefined
/** Bind once before the interface reads or types a draft. */
export let configureDrafts = (value: DraftHost): void => {
  host = value
  bound = undefined
  only.value = undefined
}
/** A terminal without a client identity may type as the graph's lone person. */
export let lone = (): Promise<void> =>
  host!.people().then((people) => {
    only.value = people.length == 1 ? people[0].entity.eid : undefined
  }).catch(() => {})
export let currentPerson = (): string | undefined => host!.by() ?? only.value
let desked = () =>
  bound ??= desk(host!.client, {
    by: () => host!.by() ?? only.value,
    stash: host!.stash(),
    report: (err) => console.warn('drafts:', err),
  })
/** The person's drafts, keyed by where they type. */
export let drafts: Drafts = {
  text: (place) => desked().text(place),
  type: (place, text) => desked().type(place, text),
  spend: (place, also) => desked().spend(place, also),
}

type Box = HTMLInputElement | HTMLTextAreaElement
/** Mirror the durable draft into an uncontrolled Field; sending spends it
 * atomically with the bundles its words became. */
export let useDraft = (
  key: string,
  ref: { current: Box | null },
  seed?: (v: string) => void,
): {
  text: string
  sync: (el: Box) => void
  spend: (also?: Bundle[]) => void | false | 0
} => {
  let text = key ? drafts.text(key) : ''
  useLayoutEffect(() => {
    let el = ref.current
    if (!el || el.value == text) return
    let at = Math.min(el.selectionStart ?? text.length, text.length)
    el.value = text
    if (el.ownerDocument.activeElement == el) el.setSelectionRange(at, at)
    seed?.(text)
  }, [text])
  return {
    text,
    sync: (el: Box) => {
      if (!key) return
      drafts.type(key, el.value)
      seed?.(el.value)
    },
    spend: (also?: Bundle[]) =>
      key
        ? drafts.spend(key, also)
        : also?.length && void host!.client.mutate(also),
  }
}
