import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h, type VNode } from 'preact'
import { useState } from 'preact/hooks'
import { Button, Card, Check, Field } from '@yaks/ui/parts'
import { type Box, type Look, mount, type Node, type Text } from './mod.ts'

let settle = () => new Promise((r) => setTimeout(r))

let look: Look = {
  tags: { h2: { fontSize: 20 }, p: { color: 'grey' } },
  classes: {
    Card: { padding: 16, color: 'ink' },
    'Button-go': { color: 'bg' },
  },
}

// Mount a tree and read its latest paint: the root's one child.
let painted = async (node: VNode) => {
  let last: Node | null = null
  let free = mount(node, look, (n) => last = n)
  await settle()
  return { free, now: () => (last as unknown as Box).children[0] }
}

let words = (n: Node): string =>
  n.kind == 'text'
    ? n.runs.map((r) => typeof r == 'string' ? r : words(r)).join('')
    : n.kind == 'box'
    ? n.children.map(words).join('|')
    : n.kind == 'toggle'
    ? `[${n.on ? 'x' : ' '}]` + n.label.join('')
    : `<${n.value}>`

test('a part paints as a box of words, its look from its tag and classes', async () => {
  let { now, free } = await painted(
    h(Card, {}, h('h2', {}, 'Trip'), h('p', {}, 'Two ', h('b', {}, 'days'))),
  )
  let card = now() as Box
  assertEquals(card.style, { padding: 16, color: 'ink' })
  assertEquals(words(card), 'Trip|Two days')
  // Words take the ink of the box around them; their own tag's look wins.
  assertEquals((card.children[0] as Text).style, {
    color: 'ink',
    fontSize: 20,
  })
  assertEquals((card.children[1] as Text).style, { color: 'grey' })
  free()
})

test('a press, a field and a toggle deliver what the person did to the app', async () => {
  let App = () => {
    let [typed, setTyped] = useState('')
    let [items, setItems] = useState<{ t: string; on: boolean }[]>([])
    return h(
      'div',
      {},
      h(
        'form',
        {
          onSubmit: (e: Event) => {
            e.preventDefault()
            setItems([...items, { t: typed, on: false }])
            setTyped('')
          },
        },
        h(Field, {
          value: typed,
          onInput: (e: Event) => setTyped((e.target as HTMLInputElement).value),
        }),
        h(Button, { type: 'submit', mod: 'go' }, 'Add'),
      ),
      items.map((item, i) =>
        h(
          Check,
          { key: i },
          h('input', {
            type: 'checkbox',
            checked: item.on,
            onChange: () =>
              setItems(items.map((x) => x == item ? { ...x, on: !x.on } : x)),
          }),
          item.t,
        )
      ),
    )
  }
  let { now, free } = await painted(h(App, {}))
  let [form] = (now() as Box).children as Box[]
  let [field, add] = form.children
  if (field.kind != 'field' || add.kind != 'text') throw new Error('unpainted')
  assertEquals(add.style, { color: 'bg' })
  field.type('Socks')
  await settle()
  add.press!()
  await settle()
  assertEquals(words(now()), '<>|Add|[ ]Socks')
  let check = (now() as Box).children[1]
  if (check.kind != 'toggle') throw new Error('no toggle')
  check.flip()
  await settle()
  assertEquals(words(now()), '<>|Add|[x]Socks')
  free()
})
