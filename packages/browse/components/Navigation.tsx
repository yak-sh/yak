// The sidebar: search at the top, then a line per place (home, each
// destination, the schema), the one you are on lit. Every line is a plain
// link; a phone folds the sidebar behind the bar's menu, and going anywhere
// folds it again.
import { signal } from '@preact/signals'
import { derivedEid } from '@yaks/graph/identity'
import { Button, Shell } from '@yaks/ui'
import { hosting, pagePath } from '../hosting.ts'
import {
  type Destination,
  destinations,
  type Place,
  placeAt,
  places,
} from '../navigation.ts'
import { owner, searchOpen } from '../live.ts'
import { sessionQueries } from '../tray_query.ts'
import { vocab } from '../types.ts'
import { front } from './fields.tsx'
import { Icon } from './icons.tsx'
import { follow, route } from './nav.tsx'
import { destinationOffers, homeOffer } from './offers.ts'
import { Waiting } from './inspect.tsx'

let { Brand, Find, Item, Label, Count } = Shell

/** Every destination this host offers, in the sidebar's order. */
export let allDestinations = (): Destination[] =>
  destinations(
    vocab,
    owner.value,
    sessionQueries(vocab).all,
    destinationOffers(),
  )

/** The sidebar's lines. Home is the page a package offers the owner, or the
 * host's own list where none does. */
export let allPlaces = (): Place[] => {
  let home = homeOffer()
  return places(
    home
      ? { name: home.name, icon: home.icon, path: '/' }
      : { name: 'Home', icon: 'house', path: '/' },
    allDestinations(),
    !!vocab.comp('_package'),
  )
}

/** What the page at `at` is called when no entity names it. */
export let titleAt = (at: string): Place | undefined => {
  let place = placeAt(at, allPlaces())
  return place?.path == '/' && !homeOffer()
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

// The app's name: the box's, or an app store's slug under its mount.
let brand = () => hosting().page.split('/').filter(Boolean)[0] ?? 'Tasks'

export let Navigation = () => {
  let lit = placeAt(route.value, allPlaces())?.path
  let go = (path: string) => (ev: MouseEvent) => {
    follow(path)(ev)
    if (ev.defaultPrevented) openSidebar(false)
  }
  let actor = owner.value
  let home = homeOffer()
  return (
    <Shell.Side aria-label='Navigation'>
      <Brand href={pagePath('/')} onClick={go('/')}>
        {brand()}
      </Brand>
      <Find>
        <Shell.Icon>
          <Icon name='search' size={16} />
        </Shell.Icon>
        <Button
          type='button'
          mod='quiet'
          aria-label='Search (/)'
          onClick={() => {
            openSidebar(false)
            searchOpen.value = true
          }}
        >
          Search <kbd>/</kbd>
        </Button>
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
          {p.path == '/' && home && actor && (
            <Waiting offer={home} eid={actor}>
              {(n) => <Count aria-label='waiting'>{n > 99 ? '99+' : n}</Count>}
            </Waiting>
          )}
        </Item>
      ))}
    </Shell.Side>
  )
}
