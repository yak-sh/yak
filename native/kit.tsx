// A kit-built app drawn natively: its view renders through Preact into the
// in-memory DOM, @yaks/native paints that as plain nodes, and this file is
// the one place they become React Native views. Which apps the shell can draw
// so is `drawn` below: their view modules are bundled with the shell for now,
// keyed by app slug; loading an app's own page module from the app is next
// (D-148409).
import { useEffect, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { type ComponentChild, h } from 'preact'
import { type Colors, look, mount, type Node, type Run } from '@yaks/native'
import { Packing } from '../apps/packing/view.ts'
import { type App, store } from './yaks.ts'

/** The apps this shell draws natively, by slug. */
export let drawn: Record<string, (app: App) => ComponentChild> = {
  packing: (app) => h(Packing, { store: store(app) }),
}

/** The phone's palette: yak.sh's gouache, on its dark floor. */
export let colors: Colors = {
  bg: '#272b35',
  surface: '#33363f',
  card: '#3b3e45',
  border: '#434856',
  border2: '#5e5f62',
  text: '#ece4d4',
  muted: '#cbc4b6',
  dim: '#96918a',
  accent: '#8cc5c3',
  link: '#8cc5c3',
  heading: '#ece4d4',
  info: '#a19b90',
  active: '#c4a070',
  positive: '#8cc5c3',
  negative: '#e5a888',
  caution: '#e5a888',
  special: '#cbc4b6',
  number: '#c4a070',
  literal: '#e5a888',
  time: '#a19b90',
  who: '#8cc5c3',
  keyword: '#e5a888',
  string: '#8cc5c3',
  fn: '#faf6ee',
  type: '#c4a070',
  attr: '#cbc4b6',
  hues: ['#8cc5c3', '#c4a070', '#a19b90', '#e5a888', '#cbc4b6', '#faf6ee'],
}

let looks = look(colors)

// A native text view takes the words' style; a press around it takes the box.
let WORDS = new Set([
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
])
let split = (style: object) => {
  let words: Record<string, unknown> = {}, box: Record<string, unknown> = {}
  for (let [k, v] of Object.entries(style)) (WORDS.has(k) ? words : box)[k] = v
  return { words, box }
}

let run = (r: Run, i: number) =>
  typeof r == 'string'
    ? r
    : (
      <Text key={r.key ?? i} style={r.style} onPress={r.press}>
        {r.runs.map(run)}
      </Text>
    )

let Draw = ({ node }: { node: Node }) => {
  switch (node.kind) {
    case 'text': {
      if (!node.press) {
        return <Text style={node.style}>{node.runs.map(run)}</Text>
      }
      let { words, box } = split(node.style)
      return (
        <Pressable
          onPress={node.press}
          style={({ pressed }) => [box, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={words}>{node.runs.map(run)}</Text>
        </Pressable>
      )
    }
    case 'field':
      return (
        <TextInput
          style={node.style}
          value={node.value}
          placeholder={node.placeholder}
          placeholderTextColor={colors.dim}
          multiline={node.lines}
          onChangeText={node.type}
          onSubmitEditing={node.submit}
          returnKeyType='done'
        />
      )
    case 'toggle': {
      let { words, box } = split(node.style)
      return (
        <Pressable
          onPress={node.flip}
          style={[box, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}
        >
          <Switch
            value={node.on}
            onValueChange={node.flip}
            trackColor={{ true: colors.accent }}
          />
          <Text style={[words, { flex: 1 }]}>{node.label.map(run)}</Text>
        </Pressable>
      )
    }
    case 'box': {
      let kids = node.children.map((c) => <Draw key={c.key} node={c} />)
      return node.press
        ? <Pressable style={node.style} onPress={node.press}>{kids}</Pressable>
        : <View style={node.style}>{kids}</View>
    }
  }
}

/** One kit-built app, drawn natively. */
export let Kit = ({ app }: { app: App }) => {
  let [node, setNode] = useState<Node | null>(null)
  useEffect(() => mount(drawn[app.slug](app), looks, setNode), [app.url])
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps='handled'
    >
      {node ? <Draw node={node} /> : null}
    </ScrollView>
  )
}

let styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 48 },
})
