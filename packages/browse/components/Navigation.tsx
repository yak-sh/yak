// The sidebar: search at the top, then a line per place (home, each
// destination, the schema), the one you are on lit. Every line is a plain
// link; a phone folds the sidebar behind the bar's menu, and going anywhere
// folds it again.
import { signal } from '@preact/signals'
import { derivedEid } from '@yaks/graph'
import { Button, Shell } from '@yaks/ui'
import { hosting, pagePath } from '../hosting.ts'
import {
  type Destination,
  destinations,
  type Place,
  placeAt,
  places,
} from '../navigation.ts'
import { owner } from '../live.ts'
import { sessionQueries } from '../tray_query.ts'
import { vocab } from '../types.ts'
import { searchPath } from '../url.ts'
import { fields, front } from './fields.tsx'
import { Icon } from './icons.tsx'
import { follow, navigate, route } from './nav.tsx'
import { useInboxCount } from './useInbox.ts'

let { Brand, Find, Item, Label, Count } = Shell

// What packages offer from their `./views` facets, set once by the door
// before the app paints.
let offered: Destination[] = []
export let offer = (more: Destination[]): void => {
  offered = [...offered, ...more]
}

/** Every destination this host offers, in the sidebar's order. */
export let allDestinations = (): Destination[] =>
  destinations(vocab, owner.value, sessionQueries(vocab).all, offered)

let inbox = () => !!vocab.comp('subscription')

/** The sidebar's lines. */
export let allPlaces = (): Place[] =>
  places(
    inbox()
      ? { name: 'Inbox', icon: 'inbox', path: '/' }
      : { name: 'Home', icon: 'house', path: '/' },
    allDestinations(),
    !!vocab.comp('_package'),
  )

/** What the page at `at` is called when no entity names it. */
export let titleAt = (at: string): Place | undefined => {
  let place = placeAt(at, allPlaces())
  return place?.path == '/' && !inbox()
    ? { ...place, name: hosting().home?.title ?? 'Home' }
    : place
}

// Whether the sidebar is slid over a phone's page: page state, never kept
// past the page, so every load starts with it folded.
let sidebarEid = derivedEid('Sidebar|browse')
let held = front.watch(`.Sidebar .entity.eid=${sidebarEid}`)
let open = signal(false)
held.subscribe((rows) => {
  open.value = !!(rows[0]?.Sidebar as { open?: boolean } | undefined)?.open
})
export let sidebarOpen = (): boolean => open.value
export let openSidebar = (yes: boolean): void =>
  void front.mutate([{ entity: { eid: sidebarEid }, Sidebar: { open: yes } }])

/** The bar's menu: where a window is narrow, the way to the sidebar. */
export let SidebarMenu = () => (
  <Shell.Menu>
    <Button
      type='button'
      mod='quiet'
      aria-label='Open navigation'
      aria-expanded={sidebarOpen()}
      onClick={() => openSidebar(!sidebarOpen())}
    >
      <Icon name='menu' size={18} />
    </Button>
  </Shell.Menu>
)

let InboxCount = ({ actor }: { actor: string }) => {
  let n = useInboxCount(actor)
  return n ? <Count aria-label='needs you'>{n > 99 ? '99+' : n}</Count> : null
}

let FIELD = 'sidebar:query'

// The app's name: the box's, or an app store's slug under its mount.
let brand = () => hosting().page.split('/').filter(Boolean)[0] ?? 'Tasks'

export let Navigation = () => {
  let lit = placeAt(route.value, allPlaces())?.path
  let go = (path: string) => (ev: MouseEvent) => {
    follow(path)(ev)
    if (ev.defaultPrevented) openSidebar(false)
  }
  let actor = owner.value
  return (
    <Shell.Side aria-label='Navigation'>
      <Brand href={pagePath('/')} onClick={go('/')}>
        {brand()}
      </Brand>
      <Find>
        <fields.Filter
          id={FIELD}
          placeholder='Search'
          aria-label='Search'
          onKey={(ev: KeyboardEvent) => {
            let text = fields.row(FIELD)?.text?.trim() ?? ''
            if (ev.key != 'Enter' || !text) return
            ev.preventDefault()
            fields.set(FIELD, '')
            navigate(searchPath(text))
            openSidebar(false)
          }}
        />
      </Find>
      {allPlaces().map((p) => (
        <Item
          key={p.path}
          href={pagePath(p.path)}
          mod={p.path == lit && 'on'}
          aria-current={p.path == lit ? 'page' : undefined}
          onClick={go(p.path)}
        >
          <Shell.Icon>
            <Icon name={p.icon} size={16} />
          </Shell.Icon>
          <Label>{p.name}</Label>
          {p.path == '/' && inbox() && actor && <InboxCount actor={actor} />}
        </Item>
      ))}
    </Shell.Side>
  )
}
