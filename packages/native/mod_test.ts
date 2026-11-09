import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type ComponentChild, h } from 'preact'
import { useState } from 'preact/hooks'
import { Button, Card, Check, Field } from '@yaks/ui/parts'
import { kit } from '@yaks/ui'
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
let painted = async (node: ComponentChild) => {
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
    : n.kind == 'field' || n.kind == 'pick'
    ? `<${n.value}>`
    : `{${n.kind}}`

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
          h(Check.Input, {
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

test('a details shows its summary until pressed, then what it holds, and closes again', async () => {
  let { now, free } = await painted(
    h('details', {}, h('summary', {}, 'Read notes'), h('p', {}, 'It asked')),
  )
  let shown = () => words(now())
  assertEquals(shown(), 'Read notes')
  let press = () => ((now() as Box).children[0] as Text).press!()
  press()
  await settle()
  assertEquals(shown(), 'Read notes|It asked')
  press()
  await settle()
  assertEquals(shown(), 'Read notes')
  free()
})

test('a field brings up the keyboard its entry takes', async () => {
  let traitsOf = async (node: ComponentChild) => {
    let { now, free } = await painted(node)
    let n = now()
    free()
    let field = n.kind == 'box' ? n.children[0] : n
    if (field.kind != 'field') throw new Error('no field')
    return field.traits
  }
  assertEquals(await traitsOf(h(Field, { type: 'email' })), {
    keyboardType: 'email-address',
    returnKeyType: 'done',
    autoCapitalize: 'none',
    autoCorrect: false,
    submitBehavior: 'blurAndSubmit',
  })
  assertEquals(await traitsOf(h(Field, { type: 'password' })), {
    secureTextEntry: true,
    returnKeyType: 'done',
    autoCapitalize: 'none',
    autoCorrect: false,
    submitBehavior: 'blurAndSubmit',
  })
  // A form's "add" keeps the keyboard up, so one entry follows another.
  assertEquals(
    await traitsOf(h('form', {}, h(Field, {}), h(Button, {}, 'Add'))),
    { returnKeyType: 'done', submitBehavior: 'submit' },
  )
  assertEquals(await traitsOf(h(Field, { lines: true, autofocus: true })), {
    returnKeyType: 'done',
    autoFocus: true,
    submitBehavior: 'newline',
  })
})

test('a select is a pick of its options, and choosing tells the app', async () => {
  let App = () => {
    let [v, setV] = useState('done')
    return h(
      Field,
      {
        choose: true,
        value: v,
        onChange: (e: Event) => setV((e.target as HTMLSelectElement).value),
      },
      h('option', { value: 'open' }, 'Open'),
      h('option', { value: 'done' }, 'Done'),
    )
  }
  let { now, free } = await painted(h(App, {}))
  let pick = now()
  if (pick.kind != 'pick') throw new Error('no pick')
  assertEquals([pick.value, pick.options], ['done', [
    { value: 'open', label: 'Open' },
    { value: 'done', label: 'Done' },
  ]])
  pick.choose('open')
  await settle()
  assertEquals((now() as typeof pick).value, 'open')
  free()
})

test('an icon is a drawing of its shapes, in the colour of its words', async () => {
  let { now, free } = await painted(
    h(Card, {}, h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M1 1' }))),
  )
  assertEquals((now() as Box).children[0], {
    kind: 'drawing',
    key: (now() as Box).children[0].key,
    style: { color: 'ink' },
    attrs: { viewbox: '0 0 24 24' },
    shapes: [{ tag: 'path', attrs: { d: 'M1 1' }, style: {}, shapes: [] }],
  })
  free()
})

test('what only a browser draws, and a view that throws, paint as a notice', async () => {
  let shown = async (node: ComponentChild) => {
    let last: Node | null = null
    let free = mount(node, look, (n) => last = n, { fell: () => {} })
    await settle()
    free()
    let n = last as Node | null
    return n?.kind == 'box' ? n.children[0] : n
  }
  let web = await shown(h('canvas', { 'aria-label': 'A map' }))
  assertEquals([web?.kind, (web as { words: string }).words], ['web', 'A map'])
  let Throws = () => {
    throw new Error('no store')
  }
  let fell = await shown(h(Throws, {}))
  assertEquals([fell?.kind, (fell as { words: string }).words], [
    'web',
    'no store',
  ])
})

test('a pressed link is followed', async () => {
  let followed: string[] = []
  let last: Node | null = null
  let free = mount(
    h('p', {}, 'See ', h('a', { href: '/trips' }, 'trips')),
    look,
    (n) => last = n,
    { follow: (href) => followed.push(href) },
  )
  await settle()
  let p = (last as unknown as Box).children[0] as Text
  ;(p.runs[1] as Text).press!()
  free()
  assertEquals(followed, ['/trips'])
})

test('a line break runs inside the words', async () => {
  let { now, free } = await painted(h('p', {}, 'one', h('br', {}), 'two'))
  assertEquals((now() as Text).runs, ['one', '\n', 'two'])
  free()
})

// Every kind of node a painted tree holds, through its boxes.
let kinds = (n: Node | null): string[] =>
  !n ? [] : [n.kind, ...n.kind == 'box' ? n.children.flatMap(kinds) : []]

test('every part of the kit paints natively, none left to the web', async () => {
  let unpainted: string[] = []
  for (let [name, piece] of Object.entries(kit)) {
    for (let [label, node] of piece.specimens()) {
      let last: Node | null = null
      let fault: unknown
      let free = mount(node, look, (n) => last = n, {
        fell: (e) => fault = e,
      })
      await settle()
      free()
      if (fault || !last || kinds(last).includes('web')) {
        unpainted.push(`${name}: ${label}`)
      }
    }
  }
  assertEquals(unpainted, [])
})
