import { door, hosting, pagePath } from '../hosting.ts'
import { vocab } from '../types.ts'
import { searchAt } from '../url.ts'
import { entityPath } from '../url.ts'
import { useEffect, useLayoutEffect } from 'preact/hooks'
import { idOf } from '../types.ts'
import { ent, mode, routeSub, row, serverName } from '../live.ts'
import { block, Id, Tabs } from '@yaks/ui'
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
  trail,
} from './nav.tsx'
import { Peek } from './Peek.tsx'
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
  Trail: 'nav',
  Main: 'div',
  Body: 'div',
})
let { Bar, Brand, Trail, Main, Body } = Frame
let { Tab } = Tabs

// The URL named nothing the cache can resolve — a typo'd id, a dead
// entity, a foreign graph's number. The 404 face keeps the whole shell
// (brand, `/` search, the : statusbar): a dead link offers the doors,
// never a blank wall.
let LostFrame = block('section', 'Lost', { Code: 'p', Id: 'code', Hint: 'p' })
let { Code, Hint } = LostFrame
let Lost = () => {
  let path = new URL(route.value, 'http://x').pathname
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
let Resolving = () => {
  let path = new URL(route.value, 'http://x').pathname
  return (
    <LostFrame>
      <Code>…</Code>
      <p>
        resolving <LostFrame.Id>{decodeURIComponent(path)}</LostFrame.Id>
      </p>
    </LostFrame>
  )
}

// The trail's last few, worn as breadcrumbs between brand and title —
// bare chips (the titlebar surround says the title; the tooltip carries
// it), each a real anchor whose plain click is the deliberate in-place
// return. A cached entity names itself; a trail eid the working set no
// longer holds (once the boot flip serves a partial cache, T-18102) is
// named by the addressed-sub sidecar's num/kind, appearing once its row
// lands. Dead entities (a null result) and still-resolving ones just drop
// out — the same "last 3 that render" the census filter gave before.
let Crumbs = () => {
  let items = trail.value.flatMap((eid) => {
    let loaded = row(eid).value != null
    let n = loaded ? undefined : serverName(eid) // kicks a resolve if unloaded
    if (!loaded && !n) return [] // gone, or not resolved yet — not a crumb
    let e = ent(eid)
    let id = n ? idOf({ eid, kind: n.kind, num: n.num }) : idOf(e)
    return [{ eid, id, tip: e.doc?.title }]
  }).slice(-3)
  if (!items.length) return null
  return (
    <Trail>
      {items.map(({ eid, id, tip }) => (
        <Id
          key={eid}
          href={entityPath(id)}
          data-tip={tip}
          onClick={follow(entityPath(id))}
        >
          {id}
        </Id>
      ))}
    </Trail>
  )
}

// The URL names the root: `/` = the root canvas, `/T-123` = that entity
// fullscreened, `?v=` picks the view. The bar is chrome — brand, the
// compact Card.Title, the view tabs — and the body renders the ROOT face
// (the unqualified ask: a doc-carrier gets the document h1 from Full,
// and the bar's title text sleeps until that h1 scrolls away). The vim
// statusbar keeps the floor.
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
  // Hold a route sub for the fullscreen root while it's this one — under a
  // partial cache an entity reached by direct URL is in no
  // defining set, so this is what loads it; a no-op under a whole-graph cache.
  let url = new URL(route.value, 'http://x')
  let sessions = !!vocab.comp('session') && allSessionsAt(route.value)
  let search = searchAt(route.value)
  let t = sessions ? null : screenTarget()
  let rootEid = t?.eid
  useLayoutEffect(() => rootEid ? routeSub(rootEid) : undefined, [rootEid])
  let goto = (t: string) => navigate(entityPath(idOf(ent(t))))
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
    let url = new URL(route.value, 'http://x')
    if (v == tabs[0]) url.searchParams.delete('v')
    else url.searchParams.set('v', v)
    navigate(url.pathname + url.search)
  }
  return (
    <Frame
      onPointerDown={() => {
        if (menu.value) menu.value = null
        if (run.value) run.value = null // a press outside is a cancel
      }}
    >
      <Navigation />
      <Main>
        <Bar>
          <NavigationToggle />
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
                <Crumbs />
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
                  {door('inspect') && (
                    <Tab
                      type='button'
                      aria-label='Inspect'
                      data-tip='Inspect'
                      onClick={() => location.assign(hosting().inspect!)}
                    >
                      <Icon name='table' />
                    </Tab>
                  )}
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
          {search != null ? <SearchPage query={search} /> : sessions
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
                <h1>
                  {hosting().home?.title ?? 'Browse'}
                </h1>
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
            : screenResolving()
            ? <Resolving />
            : <Lost />}
        </Body>
        <Status />
      </Main>
      <Menu />
      <Peek />
      <Run />
      <Search open={goto} />
      <Keybindings />
    </Frame>
  )
}
