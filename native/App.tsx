// The yaks.app shell: sign in once, then the space's Operator, its apps, and
// its pages. A kit-built app is drawn natively (kit.tsx); every other app,
// and the Operator for now, open as their web pages in a web view that holds
// the same session.
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { WebView } from 'react-native-webview'
import { colors, Kit } from './kit.tsx'
import { nativeOf, type NativeView, viewAt } from './remote.ts'
import {
  APEX,
  type App as AppRow,
  ask,
  SignedOut,
  type Space,
  spaces,
  spend,
} from './yaks.ts'

type Tab = 'operator' | 'apps' | 'space'

let Web = ({ url }: { url: string }) => (
  <WebView
    source={{ uri: url }}
    style={styles.page}
    sharedCookiesEnabled
    allowsInlineMediaPlayback
    mediaPlaybackRequiresUserAction={false}
    mediaCapturePermissionGrantType='grant'
    allowsBackForwardNavigationGestures
  />
)

let Button = (
  { title, onPress, quiet }: {
    title: string
    onPress: () => void
    quiet?: boolean
  },
) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      quiet ? styles.quiet : styles.go,
      { opacity: pressed ? 0.6 : 1 },
    ]}
  >
    <Text style={quiet ? styles.quietText : styles.goText}>{title}</Text>
  </Pressable>
)

// The sign-in card, as the web's: an address, then the code sent to it.
let SignIn = ({ done }: { done: () => void }) => {
  let [address, setAddress] = useState('')
  let [code, setCode] = useState('')
  let [sent, setSent] = useState(false)
  let [trouble, setTrouble] = useState('')
  let [busy, setBusy] = useState(false)
  let act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    setTrouble('')
    try {
      await fn()
    } catch (e) {
      setTrouble(
        e instanceof SignedOut
          ? 'That code did not sign you in. Check it and try again.'
          : String((e as Error).message),
      )
    }
    setBusy(false)
  }
  return (
    <View style={styles.card}>
      <Text style={styles.h1}>yaks.app</Text>
      <Text style={styles.p}>
        {sent
          ? `Type the code sent to ${address}.`
          : 'Sign in with your email address or phone number.'}
      </Text>
      {sent
        ? (
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder='six digits'
            placeholderTextColor={colors.dim}
            keyboardType='number-pad'
            textContentType='oneTimeCode'
            autoFocus
          />
        )
        : (
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder='you@example.com'
            placeholderTextColor={colors.dim}
            autoCapitalize='none'
            autoComplete='email'
            keyboardType='email-address'
            autoFocus
          />
        )}
      {busy ? <ActivityIndicator color={colors.accent} /> : (
        <Button
          title={sent ? 'Sign in' : 'Send me a code'}
          onPress={act(async () => {
            if (!sent) {
              await ask(address.trim())
              setSent(true)
            } else {
              await spend(address.trim(), code.trim())
              done()
            }
          })}
        />
      )}
      {sent
        ? (
          <Button
            quiet
            title='Use another address'
            onPress={() => setSent(false)}
          />
        )
        : null}
      {trouble ? <Text style={styles.trouble}>{trouble}</Text> : null}
    </View>
  )
}

let Apps = (
  { space, open }: { space: Space; open: (app: AppRow) => void },
) => (
  <FlatList
    style={styles.page}
    contentContainerStyle={{ padding: 16, gap: 8 }}
    data={space.apps}
    keyExtractor={(a) => a.slug}
    renderItem={({ item }) => (
      <Pressable
        onPress={() => open(item)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowSub}>
          {item.access}
        </Text>
      </Pressable>
    )}
  />
)

let PAGES = [
  ['Updates', 'updates'],
  ['Connections', 'connections'],
  ['People', 'people'],
  ['Settings', 'settings'],
]

let Pages = (
  { space, open }: { space: Space; open: (url: string) => void },
) => (
  <View style={[styles.page, { padding: 16, gap: 8 }]}>
    {PAGES.map(([title, view]) => (
      <Pressable
        key={view}
        onPress={() => open(`${APEX}/manage/${space.slug}/${view}`)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={styles.rowTitle}>{title}</Text>
      </Pressable>
    ))}
  </View>
)

let TABS: [Tab, string][] = [
  ['operator', 'Operator'],
  ['apps', 'Apps'],
  ['space', 'Space'],
]

// An app, drawn natively when its page names a native view the shell can
// load, and as its web page otherwise.
let Opened = ({ app }: { app: AppRow }) => {
  let [view, setView] = useState<NativeView | null | 'web'>(null)
  useEffect(() => {
    setView(null)
    nativeOf(app)
      .then((url) => url ? viewAt(url) : 'web' as const)
      .then(setView, (e) => {
        console.warn(`${app.url} opens on the web: ${e.message}`)
        setView('web')
      })
  }, [app.url])
  if (view == null) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }
  return view == 'web' ? <Web url={app.url} /> : <Kit app={app} view={view} />
}

// What a tab has open over it: an app, or one of the space's pages.
type Open = { app: AppRow } | { url: string } | null

let Shell = ({ all }: { all: Space[] }) => {
  let [space, setSpace] = useState(
    all.find((s) => s.role == 'owner') ?? all[0],
  )
  let [tab, setTab] = useState<Tab>('operator')
  let [open, setOpen] = useState<Open>(null)
  let title = open && 'app' in open ? open.app.title : space.title
  let body = open
    ? 'app' in open ? <Opened app={open.app} /> : <Web url={open.url} />
    : tab == 'operator'
    ? <Web url={`${APEX}/manage/${space.slug}/operator`} />
    : tab == 'apps'
    ? <Apps space={space} open={(app) => setOpen({ app })} />
    : <Pages space={space} open={(url) => setOpen({ url })} />
  let next = () => {
    let i = all.indexOf(space)
    setSpace(all[(i + 1) % all.length])
    setOpen(null)
  }
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        {open
          ? <Button quiet title='‹ Back' onPress={() => setOpen(null)} />
          : <View style={{ width: 64 }} />}
        <Pressable onPress={all.length > 1 ? next : undefined}>
          <Text style={styles.barTitle}>
            {title}
            {all.length > 1 && !open ? ' ⇄' : ''}
          </Text>
        </Pressable>
        <View style={{ width: 64 }} />
      </View>
      <View style={styles.page}>{body}</View>
      <View style={styles.tabs}>
        {TABS.map(([t, label]) => (
          <Pressable
            key={t}
            style={styles.tab}
            onPress={() => {
              setTab(t)
              setOpen(null)
            }}
          >
            <Text
              style={[styles.tabText, t == tab && { color: colors.accent }]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

export default function App() {
  let [all, setAll] = useState<Space[] | null | 'out'>(null)
  let load = () =>
    spaces().then(setAll, (e) => {
      if (!(e instanceof SignedOut)) console.warn(e)
      setAll('out')
    })
  useEffect(() => {
    load()
  }, [])
  return (
    <SafeAreaProvider>
      <StatusBar style='light' />
      {all == null
        ? (
          <View style={[styles.page, styles.center]}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )
        : all == 'out'
        ? (
          <SafeAreaView style={[styles.page, styles.center]}>
            <SignIn done={load} />
          </SafeAreaView>
        )
        : <Shell all={all} />}
    </SafeAreaProvider>
  )
}

let styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  card: { width: '86%', gap: 14 },
  h1: { fontSize: 32, fontWeight: '700', color: colors.heading },
  p: { fontSize: 16, color: colors.muted },
  input: {
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  go: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  goText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  quiet: { padding: 8 },
  quietText: { color: colors.accent, fontSize: 16 },
  trouble: { color: colors.negative, fontSize: 15 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    height: 44,
  },
  barTitle: { color: colors.heading, fontSize: 17, fontWeight: '600' },
  row: { backgroundColor: colors.card, borderRadius: 12, padding: 14, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 17, fontWeight: '500' },
  rowSub: { color: colors.muted, fontSize: 13 },
  tabs: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
})
