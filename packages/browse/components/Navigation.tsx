// The sidebar owns its labels, folding and counts; every entry is a registry
// view, including described vocabulary entities. No second kind renderer here.
import { pagePath, storageKey } from '../hosting.ts'
import { type Ent, vocab } from '../types.ts'
import { signal } from '@preact/signals'
import { derivedEid } from '@yaks/graph'
import { useEffect } from 'preact/hooks'
import {
  favoritePin,
  sidebarComponent,
  sidebarMatches,
  sidebarQueries,
} from '../navigation.ts'
import { cache, ent, mode, mutate, owner } from '../live.ts'
import { allSessionsPath } from '../tray_query.ts'
import { follow, navigate } from './nav.tsx'
import { Button, Index, Panes, Rows, Section } from '@yaks/ui'
import { useQueryResult } from './useQuery.ts'
import { useInboxThreads } from './useInbox.ts'
import { usePage } from './page.ts'
import { fields, front } from './fields.tsx'
import { Entity } from './Entity.tsx'
import { useCensus } from '@yaks/inspect'
import { inspectIo } from './inspect.tsx'
import { Icon } from './icons.tsx'
import { CARD_DATA, cardData } from './drag.ts'
import { searchPath } from '../url.ts'
import { type ComponentChildren } from 'preact'

let narrow = () => globalThis.matchMedia?.('(max-width: 700px)').matches
let remembered = globalThis.localStorage?.getItem(
  storageKey('tasks-navigation'),
)
let sidebarEid = derivedEid('Sidebar|browse')
let view = front.watch(`.Sidebar .entity.eid=${sidebarEid}`)
let held = signal(view.value)
view.subscribe((rows) => held.value = rows)
export let navigationOpen = {
  get value(): boolean {
    return (held.value[0]?.Sidebar as { open?: boolean })?.open ??
      (remembered ? remembered == 'open' : !narrow())
  },
}
export let toggleNavigation = (open = !navigationOpen.value) => {
  void front.mutate([{ entity: { eid: sidebarEid }, Sidebar: { open } }])
  globalThis.localStorage?.setItem(
    storageKey('tasks-navigation'),
    open ? 'open' : 'shut',
  )
}
export let navigationKey = (
  key: string,
  repeat = false,
  typing = false,
  modified = false,
) => {
  if (mode.value != 'normal' || repeat || typing || modified || key != 'n') {
    return false
  }
  toggleNavigation()
  return true
}

export let NavigationToggle = () => (
  <Button
    type='button'
    mod='quiet'
    aria-label={navigationOpen.value ? 'Close navigation' : 'Open navigation'}
    aria-expanded={navigationOpen.value}
    onClick={() => toggleNavigation()}
  >
    <Icon name='menu' />
  </Button>
)

let InboxCount = ({ actor }: { actor: string }) => {
  let found = useInboxThreads(actor)
  let count = found.ready
    ? found.threads.filter((t) => t.lane == 'Needs you').length
    : undefined
  return (
    <Section.Count aria-label='Needs you'>
      {count ?? '…'} Needs you
    </Section.Count>
  )
}

let Sidebar = () => {
  let census = useCensus(inspectIo)
  let actor = owner.value
  let q = sidebarQueries(vocab, actor)
  let read = (query: string) => useQueryResult(query, true, true).eids.map(ent)
  let favorites = read(q.favorites)
  let packages = read(q.packages)
  let components = read(q.components)
  let searches = read(q.searches)
  let recent = read(q.recent)
  let personal = read(q.sessions)
  let running = read(q.running)
  let sessions = [
    ...new Set([...running.map((e) => e.eid), ...personal.map((e) => e.eid)]),
  ]
  let state = usePage<{ closed: string[] }>('Sidebar', 'browse')
  let closed = state.value?.closed ?? packages.map((p) => p.eid)
  let fold = (key: string) =>
    state.set({
      closed: closed.includes(key)
        ? closed.filter((k) => k != key)
        : [...closed, key],
    })
  let field = 'sidebar:query'
  let text = fields.row(field)?.text ?? ''
  let matches = (e: Ent) => sidebarMatches(e, text)
  let close = () => narrow() && toggleNavigation(false)
  let tile = (e: Ent) => {
    let href = '/' + e.eid
    return (
      <Index.Item
        key={e.eid}
        href={pagePath(href)}
        onClickCapture={(ev: MouseEvent) => {
          follow(href)(ev)
          if (ev.defaultPrevented) close()
        }}
      >
        <Entity eid={e.eid} view='Sidebar.Tile' onOpen={close} />
      </Index.Item>
    )
  }
  let list = (items: Ent[]) => items.filter(matches).map(tile)
  let section = (
    name: string,
    children: ComponentChildren,
    count?: ComponentChildren,
  ) => (
    <Index.Group key={name} aria-label={name}>
      <Index.Head
        role='button'
        tabIndex={0}
        aria-expanded={!closed.includes(name)}
        onClick={() => fold(name)}
        onKeyDown={(ev: KeyboardEvent) => {
          if (ev.key == 'Enter' || ev.key == ' ') {
            ev.preventDefault()
            fold(name)
          }
        }}
      >
        {closed.includes(name) ? '▸' : '▾'} {name}
        {count != null && <Section.Count>{count}</Section.Count>}
      </Index.Head>
      {!closed.includes(name) && children}
    </Index.Group>
  )
  // Described rows can be outside a partial working set. Own their one batch
  // while they are visible, rather than one full addressed read per component.
  let packs = packages.filter((p) =>
    matches(p) ||
    components.some((c) => sidebarComponent(c)?.package == p.eid && matches(c))
  )
  return (
    <>
      <Panes.Top>
        <fields.Filter
          id={field}
          placeholder='Filter sidebar or run a query…'
          aria-label='Filter sidebar'
          onKey={(ev: KeyboardEvent) => {
            if (ev.key != 'Enter') return
            ev.preventDefault()
            navigate(searchPath(fields.row(field)?.text ?? ''))
            close()
          }}
        />
      </Panes.Top>
      <Panes.Body class='Navigation-body'>
        <Index>
          {section(
            'Inbox',
            actor && (
              <Index.Item
                href={pagePath('/')}
                onClick={(ev: MouseEvent) => {
                  follow('/')(ev)
                  if (ev.defaultPrevented) close()
                }}
              >
                Open inbox
              </Index.Item>
            ),
            actor && <InboxCount actor={actor} />,
          )}
          {section(
            'Favorites',
            <>
              {list(favorites)}
              {!favorites.length && (
                <Rows.More>Drop an entity here to favorite it.</Rows.More>
              )}
            </>,
            favorites.length,
          )}
          {section(
            'Packages',
            packs.map((p) => {
              let cs = components.filter((c) =>
                sidebarComponent(c)?.package == p.eid &&
                (matches(p) || matches(c))
              )
              return (
                <Index.Group key={p.eid}>
                  <Button
                    mod='quiet'
                    type='button'
                    aria-label='Toggle package components'
                    aria-expanded={!closed.includes(p.eid)}
                    onClick={() => fold(p.eid)}
                  >
                    {closed.includes(p.eid) ? '▸' : '▾'}
                  </Button>
                  {tile(p)}
                  <Section.Count>
                    {components.filter((c) =>
                      sidebarComponent(c)?.package == p.eid
                    ).length}
                  </Section.Count>
                  {!closed.includes(p.eid) &&
                    cs.map((c) => (
                      <Index.Group key={c.eid}>
                        {tile(c)}
                        <Section.Count>
                          {census.error ? '!' : census.ready
                            ? census
                              .carried[String(sidebarComponent(c)?.name)] ?? 0
                            : '…'}
                        </Section.Count>
                      </Index.Group>
                    ))}
                </Index.Group>
              )
            }),
            packages.length,
          )}
          {section('Saved searches', list(searches), searches.length)}
          {section('Recent', list(recent), recent.length)}
          {section(
            'Sessions',
            <>
              <Index.Item
                href={pagePath(allSessionsPath)}
                onClick={(ev: MouseEvent) => {
                  follow(allSessionsPath)(ev)
                  if (ev.defaultPrevented) close()
                }}
              >
                All sessions
              </Index.Item>
              {list(sessions.map(ent))}
            </>,
            sessions.length,
          )}
        </Index>
      </Panes.Body>
    </>
  )
}

export let Navigation = () => {
  let view = usePage<{ hover: boolean }>('Sidebar', 'browse')
  let over = view.value?.hover
  let setOver = (hover: boolean) => view.set({ hover })
  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      let typing = e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      if (
        navigationKey(
          e.key,
          e.repeat,
          typing,
          e.metaKey || e.ctrlKey || e.altKey,
        )
      ) e.preventDefault()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  if (!navigationOpen.value) return null
  let accepts = (ev: DragEvent) =>
    !!ev.dataTransfer && Array.from(ev.dataTransfer.types).includes(CARD_DATA)
  return (
    <>
      <Button
        class='Navigation-shade'
        type='button'
        aria-label='Close navigation'
        onClick={() => toggleNavigation(false)}
      />
      <Panes.Pane
        mod='nav'
        class='Navigation'
        aria-label='Browse sidebar'
        data-drop={over || undefined}
        onDragOver={(ev: DragEvent) => {
          if (accepts(ev)) {
            ev.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(ev: DragEvent) => {
          setOver(false)
          let data = cardData(ev.dataTransfer?.getData(CARD_DATA) ?? '')
          if (
            !data || !cache.peek()[data.target] || !vocab.comp('favorite')
          ) return
          ev.preventDefault()
          let change = favoritePin(ent(data.target))
          if (change) mutate(change)
        }}
      >
        <Sidebar />
      </Panes.Pane>
    </>
  )
}
