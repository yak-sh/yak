// A kit-built app drawn natively: its view (loaded from the app by
// @yaks/native/remote) renders through Preact into the in-memory DOM,
// @yaks/native paints that as plain nodes, and this file is the one place
// they become React Native views. Each feels as iOS's own does: a field
// brings up the keyboard its entry takes and stays up while a list is added
// to, a pick is an action sheet, a switch and a pick tick under the finger,
// the page scrolls with momentum, the keyboard is dragged away with it, and a
// pull refreshes it. What only a browser draws, or a view that breaks, says
// so and opens the app's web page.
import {
  Component,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  ActionSheetIOS,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import Svg, {
  Circle,
  Ellipse,
  G,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg'
import { h } from 'preact'
import {
  type Colors,
  type Drawing,
  look,
  mount,
  type Node,
  type Pick,
  type Run,
  type Shape,
} from '@yaks/native'
import { type NativeView, store } from '@yaks/native/remote'
import type { App } from './yaks.ts'
import { report } from './report.ts'

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

/** What a drawing knows of the page it is on: the address its relative
 * links and pictures are read against, and how to open it on the web. */
let Host = createContext<{ base: string; web?: (url: string) => void }>({
  base: '',
})

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

// The touch iOS gives a switch and a picker's wheel as they move.
let tick = () => Haptics.selectionAsync().catch(() => {})

let dimmed = ({ pressed }: { pressed: boolean }) => ({
  opacity: pressed ? 0.6 : 1,
})

let run = (r: Run, i: number) =>
  typeof r == 'string' ? r : (
    <Text key={r.key ?? i} style={r.style} onPress={r.press}>
      {r.runs.map(run)}
    </Text>
  )

// A pick opens iOS's action sheet of its options, the chosen one marked.
let choose = (node: Pick) => {
  let labels = node.options.map((o) =>
    o.value == node.value ? `${o.label} ✓` : o.label
  )
  let chosen = (i: number) => {
    if (i >= node.options.length) return
    tick()
    node.choose(node.options[i].value)
  }
  if (Platform.OS == 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...labels, 'Cancel'], cancelButtonIndex: labels.length },
      chosen,
    )
  } else {
    Alert.alert(
      '',
      '',
      labels.map((text, i) => ({ text, onPress: () => chosen(i) })),
    )
  }
}

// A drawing's shapes as react-native-svg's, its attributes and its look in
// their names: `stroke-width` as `strokeWidth`, the DOM's lowercased
// `viewbox` as `viewBox`.
let SHAPES: Record<string, ComponentType<Record<string, unknown>>> = {
  circle: Circle,
  ellipse: Ellipse,
  g: G,
  line: Line,
  path: Path,
  polygon: Polygon,
  polyline: Polyline,
  rect: Rect,
  text: SvgText,
}
let CASED: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
}
let PAINT = new Set([
  'fill',
  'fillOpacity',
  'opacity',
  'stroke',
  'strokeDasharray',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeOpacity',
  'strokeWidth',
])
let propsOf = (attrs: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(attrs).filter(([k]) =>
      !['class', 'style', 'aria-hidden', 'focusable', 'role'].includes(k)
    ).map(([k, v]) => [
      CASED[k] ?? k.replace(/-(\w)/g, (_, c) => c.toUpperCase()),
      v,
    ]),
  )
let paintOf = (style: object) => {
  let paint: Record<string, unknown> = {}, rest: Record<string, unknown> = {}
  for (let [k, v] of Object.entries(style)) {
    ;(PAINT.has(k) ? paint : rest)[k] = v
  }
  return { paint, rest }
}

let shaped = (s: Shape, i: number): ReactNode => {
  let Of = SHAPES[s.tag]
  if (!Of) return null
  return (
    <Of key={i} {...propsOf(s.attrs)} {...paintOf(s.style).paint}>
      {s.tag == 'text' ? null : s.shapes.map(shaped)}
    </Of>
  )
}

// A drawing as tall as its look says, or across the width it is given at
// the shape its viewBox has.
let Drawn = ({ node }: { node: Drawing }) => {
  let { color, ...style } = node.style as Record<string, unknown>
  let { paint, rest } = paintOf(style)
  let props = propsOf(node.attrs)
  let [, , w, h] = String(props.viewBox ?? '0 0 24 24').split(/[\s,]+/)
    .map(Number)
  let sized = rest.width != null || rest.height != null
  return (
    <View
      style={[sized ? null : { width: '100%', aspectRatio: w / h || 1 }, rest]}
    >
      <Svg
        width='100%'
        height='100%'
        color={color as string}
        {...props}
        {...paint}
      >
        {node.shapes.map(shaped)}
      </Svg>
    </View>
  )
}

// What the shell cannot draw, said as such, with the app's page a press away.
let Elsewhere = ({ words }: { words: string }) => {
  let { base, web } = useContext(Host)
  return (
    <Pressable
      onPress={web && (() => web(base))}
      style={(s) => [styles.elsewhere, dimmed(s)]}
    >
      <Text style={styles.elsewhereText}>
        This part shows on the app’s web page{words ? `: ${words}` : ''}.
      </Text>
      {web ? <Text style={styles.elsewhereGo}>Open it on the web</Text> : null}
    </Pressable>
  )
}

/** A painted node as React Native views. */
export let Draw = ({ node }: { node: Node }) => {
  let { base } = useContext(Host)
  switch (node.kind) {
    case 'text': {
      if (!node.press) {
        return <Text style={node.style}>{node.runs.map(run)}</Text>
      }
      let { words, box } = split(node.style)
      return (
        <Pressable onPress={node.press} style={(s) => [box, dimmed(s)]}>
          <Text style={words}>{node.runs.map(run)}</Text>
        </Pressable>
      )
    }
    case 'field':
      return (
        <TextInput
          {
            // An `autocomplete` iOS does not know is one it ignores.
            ...node.traits as TextInputProps
          }
          style={node.style}
          value={node.value}
          placeholder={node.placeholder}
          placeholderTextColor={colors.dim}
          multiline={node.lines}
          onChangeText={node.type}
          onSubmitEditing={node.submit}
        />
      )
    case 'toggle': {
      let { words, box } = split(node.style)
      let flip = () => {
        tick()
        node.flip()
      }
      return (
        <Pressable
          onPress={flip}
          style={[box, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}
        >
          <Switch
            value={node.on}
            onValueChange={flip}
            trackColor={{ true: colors.accent }}
          />
          <Text style={[words, { flex: 1 }]}>{node.label.map(run)}</Text>
        </Pressable>
      )
    }
    case 'pick': {
      let { words, box } = split(node.style)
      let label = node.options.find((o) => o.value == node.value)?.label ?? ''
      return (
        <Pressable
          disabled={node.disabled}
          onPress={() => choose(node)}
          style={(s) => [box, styles.pick, dimmed(s)]}
        >
          <Text style={[words, { flex: 1 }]}>{label}</Text>
          <Text style={[words, { color: colors.dim }]}>⌄</Text>
        </Pressable>
      )
    }
    case 'drawing':
      return <Drawn node={node} />
    case 'image':
      return (
        <Image
          source={{ uri: new URL(node.uri, base || undefined).href }}
          accessibilityLabel={node.alt}
          style={node.style}
          resizeMode='cover'
        />
      )
    case 'web':
      return <Elsewhere words={node.words} />
    case 'box': {
      let kids = node.children.map((c) => <Draw key={c.key} node={c} />)
      return node.press
        ? (
          <Pressable
            style={(s) => [node.style, dimmed(s)]}
            onPress={node.press}
          >
            {kids}
          </Pressable>
        )
        : <View style={node.style}>{kids}</View>
    }
  }
}

// A drawing that throws shows the app's web page a press away, rather than
// taking the shell down.
class Caught extends Component<{ children: ReactNode }, { fault?: string }> {
  override state: { fault?: string } = {}
  static getDerivedStateFromError(e: Error) {
    return { fault: e.message }
  }
  override componentDidCatch(e: Error) {
    report(e)
  }
  override render() {
    return this.state.fault != null
      ? <Elsewhere words={this.state.fault} />
      : this.props.children
  }
}

/** One kit-built app, drawn natively; `web` opens a page of it on the web. */
export let Kit = (
  { app, view, web }: {
    app: App
    view: NativeView
    web: (url: string) => void
  },
) => {
  let [node, setNode] = useState<Node | null>(null)
  // A pull mounts the view again, which reads its rows afresh.
  let [round, setRound] = useState(0)
  let [pulled, setPulled] = useState(false)
  useEffect(() => {
    let home = new URL(app.url)
    return mount(
      h(view, { store: store(`${app.url}api`) }),
      looks,
      (n) => {
        setNode(n)
        setPulled(false)
      },
      {
        fell: report,
        // A link within the app opens its page; any other, the browser.
        follow: (href) => {
          let to = new URL(href, home)
          if (to.origin == home.origin) web(to.href)
          else Linking.openURL(to.href)
        },
      },
    )
  }, [app.url, view, round])
  return (
    <Host.Provider value={{ base: app.url, web }}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='interactive'
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={pulled}
            tintColor={colors.muted}
            onRefresh={() => {
              setPulled(true)
              setRound((r) => r + 1)
            }}
          />
        }
      >
        <Caught key={round}>{node ? <Draw node={node} /> : null}</Caught>
      </ScrollView>
    </Host.Provider>
  )
}

let styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 48 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  elsewhere: {
    borderColor: colors.border2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  elsewhereText: { color: colors.muted, fontSize: 15 },
  elsewhereGo: { color: colors.link, fontSize: 15, fontWeight: '600' },
})
