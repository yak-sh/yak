/**
 * The packing list itself: what to bring, and what is packed. Built of
 * @yaks/ui's parts alone, so one module draws it in a browser and in the iOS
 * shell, where @yaks/native paints the same tree with native views. Where its
 * rows are kept is the host's: the page hands it the app's own store, the
 * shell the same store over HTTP.
 *
 * @module
 */

import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Button, Card, Check, Empty, Field } from '@yaks/ui'

/** One thing to bring: its words, and when it was packed. */
export type Item = {
  entity: { eid: string }
  doc?: { title?: string }
  packed?: { at: string } | null
}

/** The app's store, as a page's `./api/client.js` offers it. */
export type Store = {
  query: (filter: string) => Promise<Item[]>
  apply: (bundles: object[]) => Promise<unknown>
}

let ITEMS = '.bring&?doc&?packed'

/** The list, with a field to add to it. */
export let Packing = ({ store }: { store: Store }) => {
  let [items, setItems] = useState<Item[]>([])
  let [typed, setTyped] = useState('')
  let [trouble, setTrouble] = useState('')
  let load = () =>
    store.query(ITEMS).then(
      setItems,
      (e) => setTrouble(String(e.message ?? e)),
    )
  useEffect(() => {
    load()
  }, [])
  let write = (bundles: object[]) =>
    store.apply(bundles).then(load, (e) => {
      setTrouble(String(e.message ?? e))
      load()
    })
  let add = (e?: Event) => {
    e?.preventDefault()
    let title = typed.trim()
    if (!title) return
    setTyped('')
    let eid = `$${Date.now()}`
    setItems([...items, { entity: { eid }, doc: { title } }])
    write([{ entity: { eid }, bring: {}, doc: { title } }])
  }
  let flip = (item: Item) => {
    let packed = item.packed ? null : { at: new Date().toISOString() }
    setItems(items.map((i) => i == item ? { ...i, packed } : i))
    write([{ entity: { eid: item.entity.eid }, packed }])
  }
  let left = items.filter((i) => !i.packed).length
  return h(
    'main',
    {},
    h(
      Card,
      {},
      h(
        Card.Head,
        {},
        h(Card.Title, {}, 'Packing list'),
        h(Card.Sub, {}, items.length ? `${left} to pack` : ''),
      ),
      h(
        'form',
        { onSubmit: add },
        h(Field, {
          value: typed,
          placeholder: 'Add something to bring',
          onInput: (e: Event) => setTyped((e.target as HTMLInputElement).value),
        }),
        h(Button, { type: 'submit', mod: 'go' }, 'Add'),
      ),
      items.length
        ? h(
          'div',
          {},
          items.map((item) =>
            h(
              Check,
              { key: item.entity.eid },
              h(Check.Input, {
                type: 'checkbox',
                checked: !!item.packed,
                onChange: () => flip(item),
              }),
              item.doc?.title ?? '',
            )
          ),
        )
        : h(
          Empty,
          {},
          h(Empty.Title, {}, 'Nothing to bring yet'),
          h('p', {}, 'Add the first thing above.'),
        ),
      trouble ? h('p', { class: 'Notice' }, trouble) : null,
    ),
  )
}

/** The view the iOS shell draws natively, named by index.html. */
export default Packing
