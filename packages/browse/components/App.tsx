import { InspectPage } from './inspect.tsx'
import { effect } from '@preact/signals'
import { opened } from '../opened.ts'
import { hosting } from '../hosting.ts'
import { left, scrolledTo } from '../history.ts'
import { destinationAt, schemaAt } from '../navigation.ts'
import { entityPath, searchAt } from '../url.ts'
import { useEffect, useLayoutEffect } from 'preact/hooks'
import { idOf } from '../types.ts'
import { ent, mode, routeSub } from '../live.ts'
import { block, Shell, Tabs, Viewport } from '@yaks/ui'
import { filterable, FilterInput } from './Filter.tsx'
import { applicable } from './registry.ts'
import { TabFace } from './Card.tsx'
import { Icon } from './icons.tsx'
import { homeOffer } from './offers.ts'
import {
  follow,
  Menu,
  menu,
  navigate,
  route,
  screenResolving,
  screenTarget,
} from './nav.tsx'
import { Run, run } from './Run.tsx'
import { Search, searchOpen, SearchPage } from './Search.tsx'
import { Status } from './Status.tsx'
import { Entity } from './Entity.tsx'
import { tips } from '@yaks/ui'
import { Keybindings } from './Keybindings.tsx'
import {
  allDestinations,
  Navigation,
  openSidebar,
  SidebarMenu,
  sidebarOpen,
  titleAt,
} from './Navigation.tsx'
import { QueryList } from './views/List.tsx'
import { Id } from './views/Inline.tsx'

tips() // mount the one delegated [data-tip] tooltip (idempotent)

let { Tab } = Tabs

// The URL named nothing the cache can resolve — a typo'd id, a dead
// entity, a foreign graph's number. The 404 face keeps the whole shell
// (the sidebar, `/` search, the : statusbar): a dead link offers the doors,
// never a blank wall.
let LostFrame = block('section', 'Lost', { Code: 'p', Id: 'code', Hint: 'p' })
let { Code, Hint } = LostFrame
let Lost = ({ at }: { at: string }) => {
  let path = new URL(at, 'http://x').pathname
  return (
    <LostFrame>
      <Code>404</Code>
      <p>
        <LostFrame.Id>{decodeURIComponent(path)}</LostFrame.Id>{' '}
        names nothing here — a mistyped id, or an entity that's gone.
      </p>
      <Hint>
        press <kbd>/</kbd> to search, or{' '}
        <a href='/' onClick={follow('/')}>
          head home
        </a>
      </Hint>
    </LostFrame>
  )
}

// The id is real but outside the working set, and its server resolve is in
// flight (nav.tsx screenResolving) — the honest interim between a cache miss
// and the answer, so a slow addressed subscription reads as "loading", never a false 404
// (M-16612). It settles to the entity or to Lost when the resolve lands.
let Resolving = ({ at }: { at: string }) => {
  let path = new URL(at, 'http://x').pathname
  return (
    <LostFrame>
      <Code>…</Code>
      <p>
        resolving <LostFrame.Id>{decodeURIComponent(path)}</LostFrame.Id>
      </p>
    </LostFrame>
  )
}

// The one page the address names, under its bar: `/` is home (the owner, in
// the home page a package offers, or the host's own list where none does),
// `/T-123` that entity with `?v=` picking its view, `/?q=` a search,
// `/?map` the schema and `/?<key>` a destination's list. The bar says what
// the page is and holds what it offers: a filter, its views, its menu.
export let Page = ({ at }: { at: string }) => {
  // Hold a route sub for the entity while it's the page — under a partial
  // cache an entity reached by direct URL is in no defining set, so this is
  // what loads it; a no-op under a whole-graph cache.
  let url = new URL(at, 'http://x')
  let search = searchAt(at)
  let place = destinationAt(at, allDestinations())
  let t = screenTarget(at)
  let home = url.pathname == '/' && !url.search
  let offered = home ? homeOffer() : undefined
  // The owner's home page holds what its view asks, never the owner's
  // neighborhood, and opening it is not opening the owner.
  let rootEid = offered ? undefined : t?.eid
  useEffect(() => {
    if (rootEid) return effect(() => opened(rootEid))
  }, [rootEid])
  useLayoutEffect(() => rootEid ? routeSub(rootEid) : undefined, [rootEid])
  let e = t ? ent(t.eid) : undefined
  let tabs = e ? applicable(e) : []
  // A coarse pointer with no explicit view defaults a Canvas to List: its
  // spatial face eagerly renders every pinned card and floods a phone (the
  // mobile door, views/List.tsx). Other pages keep their first face.
  let coarse = globalThis.matchMedia?.('(pointer: coarse)').matches
  let view = t?.view && tabs.includes(t.view)
    ? t.view
    : e && (e._comp || e._package || e._prop) && tabs.includes('Inspect.Page')
    ? 'Inspect.Page'
    : coarse && tabs[0] == 'Canvas' && tabs.includes('List')
    ? 'List'
    : tabs[0]
  let show = (v: string) => {
    let url = new URL(at, 'http://x')
    if (v == tabs[0]) url.searchParams.delete('v')
    else url.searchParams.set('v', v)
    navigate(url.pathname + url.search, { replace: true })
  }
  // Home is the owner in the home page a package offers, or the host's own
  // list where none does; either way it is named for itself, never for the
  // person.
  let list = home && !offered
  let named = titleAt(at)
  let page = home ? undefined : e
  let filter = place
    ? `destination:${place.key}`
    : list
    ? 'app-browse'
    : page && filterable.has(view ?? '')
    ? page.eid
    : undefined
  return (
    <>
      <Shell.Bar>
        <SidebarMenu />
        <Shell.Title>
          {page
            ? (
              <>
                <Id e={page} />
                <Entity eid={page.eid} view='Bar.Title' />
              </>
            )
            : search != null
            ? (
              <>
                <Shell.Icon>
                  <Icon name='search' size={16} />
                </Shell.Icon>
                Search
              </>
            )
            : named && (
              <>
                <Shell.Icon>
                  <Icon name={named.icon} size={16} />
                </Shell.Icon>
                {named.name}
              </>
            )}
        </Shell.Title>
        <Shell.Tools>
          {filter && <FilterInput eid={filter} />}
          {page && (
            <Tabs>
              {tabs.length > 1 && tabs.map((v) => (
                <Tab
                  type='button'
                  key={v}
                  mod={v == view && 'on'}
                  aria-label={v}
                  data-tip={v}
                  onClick={() => v != view && show(v)}
                >
                  <TabFace view={v} eid={page.eid} />
                </Tab>
              ))}
              {
                /* The page's dropdown: the same menu a card's right-click
              serves, hung from the bar's far edge. Pointerdown must not
              bubble — the shell's close-on-press would eat the toggle. */
              }
              <Tab
                type='button'
                aria-label='Menu'
                data-tip='menu'
                onPointerDown={(ev: Event) => ev.stopPropagation()}
                onClick={(
                  ev: MouseEvent & { currentTarget: HTMLElement },
                ) => {
                  if (menu.value) {
                    menu.value = null
                    return
                  }
                  let r = ev.currentTarget.getBoundingClientRect()
                  menu.value = {
                    x: r.right,
                    y: r.bottom,
                    href: entityPath(idOf(page)),
                    eid: page.eid,
                    align: 'right',
                  }
                }}
              >
                <Icon name='ellipsis-vertical' />
              </Tab>
            </Tabs>
          )}
        </Shell.Tools>
      </Shell.Bar>
      <Viewport
        id={`browse:${at}`}
        class='Shell_Body'
        start={left.value}
        onScroll={scrolledTo}
      >
        {schemaAt(at)
          ? <InspectPage map />
          : search != null
          ? <SearchPage query={search} />
          : place
          ? <QueryList eid={filter!} query={place.query} />
          : offered && e
          ? <Entity eid={e.eid} view={offered.view} />
          : e
          ? <Entity eid={e.eid} view={view} />
          : list
          ? (
            <QueryList
              eid='app-browse'
              query={hosting().home?.query ?? '.doc'}
            />
          )
          : offered
          ? (
            <LostFrame>
              <h1>{offered.name}</h1>
              <p>No owner is named for this app.</p>
            </LostFrame>
          )
          : screenResolving(at)
          ? <Resolving at={at} />
          : <Lost at={at} />}
      </Viewport>
    </>
  )
}

export let App = () => {
  // `/` raises the search palette over ANY page — canvas, doc, board.
  // The shell owns the hotkey and the one <Search> mount so any page can
  // search; a pick opens the hit as the page in its default view.
  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      if (mode.value != 'normal' || e.repeat || e.key != '/') return
      if (
        e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      ) return
      e.preventDefault()
      searchOpen.value = true
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  return (
    <Shell
      mod={sidebarOpen() && 'open'}
      onPointerDown={() => {
        menu.value = null
        run.value = null
      }}
    >
      <Navigation />
      <Shell.Shade
        type='button'
        aria-label='Close navigation'
        onClick={() => openSidebar(false)}
      />
      <Shell.Main>
        <Page key={route.value} at={route.value} />
        <Status />
      </Shell.Main>
      <Menu />
      <Run />
      <Search open={(eid) => navigate(entityPath(idOf(ent(eid))))} />
      <Keybindings />
    </Shell>
  )
}
