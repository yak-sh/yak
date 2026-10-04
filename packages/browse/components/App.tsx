import { InspectPage } from './inspect.tsx'
import { effect } from '@preact/signals'
import { type PaneProps, Stack } from '@yaks/ux'
import { changeFrames, frames } from '../history.ts'
import { opened } from '../opened.ts'
import { hosting, pagePath } from '../hosting.ts'
import { vocab } from '../types.ts'
import { searchAt } from '../url.ts'
import { entityPath } from '../url.ts'
import { useEffect, useLayoutEffect } from 'preact/hooks'
import { idOf } from '../types.ts'
import { ent, mode, routeSub } from '../live.ts'
import { block, Tabs } from '@yaks/ui'
import { filterable, FilterInput } from './Filter.tsx'
import { applicable } from './registry.ts'
import { TabFace } from './Card.tsx'
import { Icon } from './icons.tsx'
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
import { Navigation, NavigationToggle } from './Navigation.tsx'
import { allSessionsAt, allSessionsKey, sessionQueries } from '../tray_query.ts'
import { QueryList } from './views/List.tsx'

tips() // mount the one delegated [data-tip] tooltip (idempotent)

let Frame = block('main', 'App', {
  Bar: 'header',
  Brand: 'a',
  Main: 'div',
  Body: 'div',
})
let { Bar, Brand, Main, Body } = Frame
let { Tab } = Tabs

// The URL named nothing the cache can resolve — a typo'd id, a dead
// entity, a foreign graph's number. The 404 face keeps the whole shell
// (brand, `/` search, the : statusbar): a dead link offers the doors,
// never a blank wall.
let LostFrame = block('section', 'Lost', { Code: 'p', Id: 'code', Hint: 'p' })
let { Code, Hint } = LostFrame
let Lost = ({ at = route.value }: { at?: string }) => {
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
let Resolving = ({ at = route.value }: { at?: string }) => {
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

// The URL names the root: `/` = the root canvas, `/T-123` = that entity
// fullscreened, `?v=` picks the view. The bar is chrome — brand, the
// compact Card.Title, the view tabs — and the body renders the ROOT face
// (the unqualified ask: a doc-carrier gets the document h1 from Full,
// and the bar's title text sleeps until that h1 scrolls away). The vim
// statusbar keeps the floor.
// A page is the top frame's content. Inspect query/map pages extend this
// renderer; Stack owns only the strips and restoring its controlled bundle.
export let Page = ({ pane }: PaneProps) => {
  // Hold a route sub for the fullscreen root while it's this one — under a
  // partial cache an entity reached by direct URL is in no
  // defining set, so this is what loads it; a no-op under a whole-graph cache.
  let url = new URL(pane, 'http://x')
  let sessions = !!vocab.comp('session') && allSessionsAt(pane)
  let search = searchAt(pane)
  let t = sessions ? null : screenTarget(pane)
  let rootEid = t?.eid
  useEffect(() => {
    if (rootEid) return effect(() => opened(rootEid))
  }, [rootEid])
  useLayoutEffect(() => rootEid ? routeSub(rootEid) : undefined, [rootEid])
  let e = t ? ent(t.eid) : undefined
  let tabs = e ? applicable(e) : []
  // A coarse pointer with no explicit view defaults a Canvas to List: its
  // spatial face eagerly renders every pinned card and floods a phone (the
  // mobile door, views/List.tsx). Other roots keep their first face.
  let coarse = globalThis.matchMedia?.('(pointer: coarse)').matches
  let view = t?.view && tabs.includes(t.view)
    ? t.view
    : coarse && tabs[0] == 'Canvas' && tabs.includes('List')
    ? 'List'
    : tabs[0]
  let show = (v: string) => {
    let url = new URL(pane, 'http://x')
    if (v == tabs[0]) url.searchParams.delete('v')
    else url.searchParams.set('v', v)
    navigate(url.pathname + url.search, { replace: true })
  }
  return (
    <>
      <Bar>
        <Brand href={pagePath('/')}>
          {vocab.comp('subscription') ? 'Inbox' : 'Browse'}
        </Brand>
        {sessions
          ? (
            <>
              <span>All sessions</span>
              <FilterInput eid={allSessionsKey} />
            </>
          )
          : e && (
            <>
              <Entity eid={e.eid} view='Card.Title' />
              {filterable.has(view ?? '') && <FilterInput eid={e.eid} />}
              <Tabs>
                {tabs.map((v) => (
                  <Tab
                    type='button'
                    key={v}
                    mod={v == view && 'on'}
                    aria-label={v}
                    data-tip={v}
                    onClick={() => v != view && show(v)}
                  >
                    <TabFace view={v} eid={e.eid} />
                  </Tab>
                ))}
                {
                  /* The root card's dropdown: the same menu a card's right-click
              serves, hung from the bar's far edge. Pointerdown must not
              bubble — the Frame's close-on-press would eat the toggle. */
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
                      href: entityPath(idOf(e)),
                      eid: e.eid,
                      align: 'right',
                    }
                  }}
                >
                  <Icon name='ellipsis-vertical' />
                </Tab>
              </Tabs>
            </>
          )}
      </Bar>
      <Body>
        {url.searchParams.has('map')
          ? <InspectPage map />
          : search != null
          ? <SearchPage query={search} />
          : sessions
          ? (
            <QueryList
              eid={allSessionsKey}
              query={sessionQueries(vocab).all}
            />
          )
          : e
          ? <Entity eid={e.eid} view={view} />
          : url.pathname == '/' && !vocab.comp('subscription')
          ? (
            <>
              <h1>{hosting().home?.title ?? 'Browse'}</h1>
              <QueryList
                eid='app-browse'
                query={hosting().home?.query ?? '.doc'}
              />
            </>
          )
          : url.pathname == '/'
          ? (
            <LostFrame>
              <h1>Inbox</h1>
              <p>No owner is named for this app.</p>
            </LostFrame>
          )
          : screenResolving(pane)
          ? <Resolving at={pane} />
          : <Lost at={pane} />}
      </Body>
    </>
  )
}

let Strip = ({ pane }: { pane: string }) => {
  let t = screenTarget(pane)
  useLayoutEffect(() => t?.eid ? routeSub(t.eid) : undefined, [t?.eid])
  return new URL(pane, 'http://x').searchParams.has('map')
    ? <span>Map</span>
    : t
    ? <Entity eid={t.eid} view='Stack.Card.Title' />
    : (
      <span>
        {searchAt(pane) != null
          ? 'Search'
          : allSessionsAt(pane)
          ? 'Sessions'
          : 'Browse'}
      </span>
    )
}

export let App = () => {
  // `/` raises the search palette over ANY root — canvas, doc, board.
  // The shell owns the hotkey and the one <Search> mount so a
  // fullscreened card can search; a pick opens the hit as the root in its
  // default view.
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
    <Frame
      onPointerDown={() => {
        menu.value = null
        run.value = null
      }}
    >
      <Navigation />
      <Main>
        <NavigationToggle />
        <Stack
          e={frames.value}
          onChange={changeFrames}
          Pane={Page}
          Strip={Strip}
          on
        />
        <Status />
      </Main>
      <Menu />
      <Run />
      <Search open={(eid) => navigate(entityPath(idOf(ent(eid))))} />
      <Keybindings />
    </Frame>
  )
}
