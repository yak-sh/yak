import { useEffect } from 'preact/hooks'
import { idOf } from '../types.ts'
import { census, ent, mode, routeSub, serverName } from '../live.ts'
import { Admin } from './Admin.tsx'
import { block, Chip, el } from './ui.tsx'
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
import { Search, searchOpen } from './Search.tsx'
import { Status } from './Status.tsx'
import { Entity } from './Entity.tsx'
import { tips } from './overlay.tsx'
import { Keybindings } from './Keybindings.tsx'
import { Account } from './Account.tsx'
import { Config } from './Config.tsx'
import { Navigation, NavigationToggle } from './Navigation.tsx'

tips() // mount the one delegated [data-tip] tooltip (idempotent)

let Frame = block('main', 'App', {
  Bar: 'header',
  Brand: 'a',
  Trail: 'nav',
  Main: 'div',
  Body: 'div',
})
let { Bar, Brand, Trail, Main, Body } = Frame
let Tab = el('button', 'Tab')

// The URL named nothing the cache can resolve — a typo'd id, a dead
// entity, a foreign graph's number. The 404 face keeps the whole shell
// (brand, `/` search, the : statusbar): a dead link offers the doors,
// never a blank wall.
let LostFrame = block('section', 'Lost', { Code: 'p', Id: 'code', Hint: 'p' })
let { Code, Id, Hint } = LostFrame
let Lost = () => {
  let path = new URL(route.value, 'http://x').pathname
  return (
    <LostFrame>
      <Code>404</Code>
      <p>
        <Id>{decodeURIComponent(path)}</Id>{' '}
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
// and the answer, so a slow /resolve reads as "loading", never a false 404
// (M-16612). It settles to the entity or to Lost when the resolve lands.
let Resolving = () => {
  let path = new URL(route.value, 'http://x').pathname
  return (
    <LostFrame>
      <Code>…</Code>
      <p>
        resolving <Id>{decodeURIComponent(path)}</Id>
      </p>
    </LostFrame>
  )
}

// The trail's last few, worn as breadcrumbs between brand and title —
// bare chips (the titlebar surround says the title; the tooltip carries
// it), each a real anchor whose plain click is the deliberate in-place
// return. A cached entity names itself; a trail eid the working set no
// longer holds (once the boot flip serves a partial cache, T-18102) is
// named by the server-resolve sidecar's num/kind, appearing once /resolve
// lands. Dead entities (a null resolve) and still-resolving ones just drop
// out — the same "last 3 that render" the census filter gave before.
let Crumbs = () => {
  let items = trail.value.flatMap((eid) => {
    let loaded = census.value.includes(eid)
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
        <Chip
          key={eid}
          href={`/${id}`}
          data-tip={tip}
          onClick={follow(`/${id}`)}
        >
          {id}
        </Chip>
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
  // `/` raises the search palette over ANY root — canvas, doc, board,
  // admin. The shell owns the hotkey and the one <Search> mount so a
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
  // partial cache (serverQuery) an entity reached by direct URL is in no
  // defining set, so this is what loads it; a no-op under a whole-graph cache.
  // Computed before the /admin early return so the hook order stays stable.
  let rootEid = route.value.startsWith('/admin')
    ? undefined
    : screenTarget()?.eid
  useEffect(() => rootEid ? routeSub(rootEid) : undefined, [rootEid])
  let goto = (t: string) => navigate(`/${idOf(ent(t))}`)

  // The census rides beside the canvas: /admin* swaps the body wholesale;
  // the bar keeps only the brand (the sidebar is the navigation there).
  if (route.value.startsWith('/admin')) {
    return (
      <Frame
        onPointerDown={() => {
          if (menu.value) menu.value = null
        }}
      >
        <Navigation />
        <Main>
          <Bar>
            <NavigationToggle />
            <Brand href='/'>Tasks</Brand>
          </Bar>
          <Body mod='admin'>
            <Admin />
          </Body>
          <Status />
        </Main>
        <Menu />
        <Peek />
        <Search open={goto} />
        <Account />
        <Config />
        <Keybindings />
      </Frame>
    )
  }
  let t = screenTarget()
  if (!t) {
    return (
      <Frame
        onPointerDown={() => {
          if (menu.value) menu.value = null
        }}
      >
        <Navigation />
        <Main>
          <Bar>
            <NavigationToggle />
            <Brand href='/'>Tasks</Brand>
          </Bar>
          <Body>
            {screenResolving() ? <Resolving /> : <Lost />}
          </Body>
          <Status />
        </Main>
        <Menu />
        <Peek />
        <Search open={goto} />
        <Account />
        <Config />
        <Keybindings />
      </Frame>
    )
  }
  let e = ent(t.eid)
  let tabs = applicable(e)
  // A coarse pointer with no explicit view defaults a Canvas to List: its
  // spatial face eagerly renders every pinned card and floods a phone (the
  // mobile door, views/List.tsx). Other roots keep their first face.
  let coarse = globalThis.matchMedia?.('(pointer: coarse)').matches
  let view = t.view && tabs.includes(t.view)
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
          <Brand href='/'>Tasks</Brand>
          <Crumbs />
          <Entity eid={e.eid} view='Card.Title' />
          {filterable.has(view) && <FilterInput eid={e.eid} />}
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
          <Tab
            type='button'
            aria-label='Admin'
            data-tip='Admin'
            onClick={() => navigate('/admin')}
          >
            <Icon name='table' />
          </Tab>
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
            onClick={(ev: MouseEvent & { currentTarget: HTMLElement }) => {
              if (menu.value) {
                menu.value = null
                return
              }
              let r = ev.currentTarget.getBoundingClientRect()
              menu.value = {
                x: r.right,
                y: r.bottom,
                href: `/${idOf(e)}`,
                eid: e.eid,
                align: 'right',
              }
            }}
          >
            <Icon name='ellipsis-vertical' />
          </Tab>
        </Bar>
        <Body>
          <Entity eid={e.eid} view={view} />
        </Body>
        <Status />
      </Main>
      <Menu />
      <Peek />
      <Run />
      <Search open={goto} />
      <Account />
      <Config />
      <Keybindings />
    </Frame>
  )
}
