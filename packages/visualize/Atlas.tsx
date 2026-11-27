/** @jsxImportSource react */
/** A process-local system MRI. The model owns navigation, filters, camera and
 * playback; this surface owns only layout, focus and display-only kit parts.
 */

import { useRef } from 'react'
import { Button, Chip, Field } from '@yaks/ui'
import { useObserved } from '@yaks/ux'
import type { AtlasModel } from './model.ts'
import { ActivityView } from './ActivityView.tsx'
import { AnatomyList, matchingEdges, PAGE_SIZE } from './AnatomyList.tsx'
import { Detail } from './Detail.tsx'
import {
  filtered,
  groupName,
  mapParts,
  sections,
  Spine,
  Topology,
  zoomed,
} from './Topology.tsx'

let connectionNames: Record<string, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  paused: 'Paused',
  offline: 'Offline',
}

let Mark = () => (
  <svg className='Atlas_Mark' viewBox='0 0 40 40' aria-hidden='true'>
    <rect
      className='Atlas_Mark_Frame'
      x='3'
      y='3'
      width='34'
      height='34'
      rx='9'
    />
    <path className='Atlas_Mark_Path' d='M7 20h7l3-7 5 15 4-8h7' />
    <circle className='Atlas_Mark_Circle' cx='20' cy='20' r='13' />
  </svg>
)

let Shortcuts = () => (
  <details className='Atlas_Shortcuts'>
    <summary className='Atlas_Summary Atlas_Shortcuts_Summary'>
      Keyboard <kbd className='Atlas_Key'>?</kbd>
    </summary>
    <dl className='Atlas_Reset Atlas_Shortcuts_List'>
      {[
        ['/', 'Focus search'],
        ['↑ / ↓', 'Select a part'],
        ['Enter', 'Focus selected detail'],
        ['+ / −', 'Zoom map'],
        ['0', 'Fit map'],
        ['P', 'Pause / resume'],
        ['L / M', 'List / map'],
        ['Esc', 'Clear selection'],
      ].map(([keys, action]) => (
        <div className='Atlas_Shortcuts_List_Row' key={keys}>
          <dt>
            <kbd className='Atlas_Key'>{keys}</kbd>
          </dt>
          <dd className='Atlas_Shortcuts_Value'>{action}</dd>
        </div>
      ))}
    </dl>
  </details>
)

export let Atlas = ({ model }: { model: AtlasModel }) => {
  useObserved(model.snapshot)
  let state = model.state
  let search = useRef<HTMLInputElement>(null)
  let root = useRef<HTMLDivElement>(null)
  let groups = sections.flatMap((section) => section.groups)
  let counts = new Map(
    groups.map((group) => [
      group,
      model.nodes.filter((node) => node.group == group).length,
    ]),
  )
  let parts = model.nodes.filter((node) => node.group != 'phases')
  let loaded = parts.filter((node) => node.loaded).length
  let bound = parts.filter((node) => node.bound).length
  let unattempted =
    parts.filter((node) =>
      node.group == 'facets' && node.detail.attempted === false
    ).length
  let unobserved = Object.entries(model.coverage)
    .filter(([, observed]) => !observed).map(([group]) => groupName(group))
  let shown = state.group == 'relations'
    ? matchingEdges(model).length
    : state.view == 'map'
    ? mapParts(model).length
    : filtered(model).length
  let connection = state.paused ? 'paused' : state.connected
  let changeGroup = (group: string) =>
    model.set({
      group,
      listPage: 0,
      ...(['relations', 'phases'].includes(group) &&
        { view: 'list' as const }),
    })
  let map = () =>
    model.set({
      view: 'map',
      ...(['relations', 'phases'].includes(state.group) &&
        { group: 'all' }),
    })
  let press = (event: KeyboardEvent) => {
    let target = event.target as Element
    if (
      event.altKey || event.ctrlKey || event.metaKey ||
      target.closest('input,textarea,select,[contenteditable="true"]')
    ) return
    let key = event.key.toLocaleLowerCase()
    if (key == '/') {
      event.preventDefault()
      search.current?.focus()
      return
    }
    if (key == 'arrowdown' || key == 'arrowup') {
      event.preventDefault()
      let ids = state.group == 'relations'
        ? matchingEdges(model).map((e) => e.id)
        : (state.view == 'map' ? mapParts(model) : filtered(model))
          .map((node) => node.id)
      if (!ids.length) return
      let at = ids.indexOf(state.selected)
      let index = at < 0 ? key == 'arrowdown' ? 0 : ids.length - 1 : Math.max(
        0,
        Math.min(ids.length - 1, at + (key == 'arrowdown' ? 1 : -1)),
      )
      model.select(ids[index])
      model.set({ listPage: Math.floor(index / PAGE_SIZE) })
      return
    }
    if (key == 'enter' && !target.closest('button,a,summary,[role="button"]')) {
      event.preventDefault()
      root.current?.querySelector<HTMLElement>('#atlas-detail')?.focus()
      return
    }
    if (key == 'escape') {
      model.select('')
      model.choose('')
    } else if (key == '+' || key == '=') zoomed(model, .2)
    else if (key == '-') zoomed(model, -.2)
    else if (key == '0') model.reset()
    else if (key == 'p') model.set({ paused: !state.paused })
    else if (key == 'l') model.set({ view: 'list' })
    else if (key == 'm') map()
    else if (key == '?') {
      let shortcuts = root.current?.querySelector<HTMLDetailsElement>(
        '.Atlas_Shortcuts',
      )
      if (shortcuts) shortcuts.open = !shortcuts.open
    }
  }
  return (
    <div
      className='Atlas'
      ref={root}
      onKeyDown={press}
      data-paused={state.paused}
      data-theme={state.theme}
      data-scheme={state.scheme}
      style={{ colorScheme: state.scheme }}
    >
      <a href='#atlas-workspace' className='Atlas_Skip Atlas_Link'>
        Skip to anatomy
      </a>
      <header className='Atlas_Header' data-ready={Boolean(state.host)}>
        <div className='Atlas_Brand'>
          <Mark />
          <div>
            <strong className='Atlas_Brand_Strong'>visualize</strong>
            <span className='Atlas_Brand_Text'>@yaks / system MRI</span>
          </div>
        </div>
        <div className='Atlas_Host'>
          <span className='Atlas_Eyebrow Atlas_Host_Text'>
            Connected process
          </span>
          <span
            className='Atlas_Host_Text'
            title={state.host || 'Waiting for host anatomy'}
          >
            {state.host || 'Awaiting anatomy…'}
          </span>
        </div>
        <div className='Atlas_HeaderControls'>
          <span
            className='Atlas_Connection'
            data-connection={connection}
            role='status'
          >
            <i className='Atlas_Connection_Indicator' aria-hidden='true' />
            {connectionNames[connection] ?? connection}
          </span>
          <Button
            type='button'
            className='Atlas_Pause Atlas_Button'
            aria-pressed={state.paused}
            title='Pause or resume recording (P)'
            onClick={() => model.set({ paused: !state.paused })}
          >
            <span aria-hidden='true'>{state.paused ? '▷' : 'Ⅱ'}</span>
            {state.paused ? 'Resume' : 'Pause'}
          </Button>
          <label className='Atlas_Theme'>
            <span className='Atlas_VisuallyHidden'>Color theme</span>
            <select
              className='Atlas_Select Atlas_Theme_Select'
              value={state.theme}
              aria-label='Color theme'
              onChange={(event) =>
                model.set({
                  theme: event.currentTarget.value as 'everforest' | 'rosepine',
                })}
            >
              <option value='everforest'>Everforest</option>
              <option value='rosepine'>Rosé Pine</option>
            </select>
          </label>
          <Button
            type='button'
            className='Atlas_Scheme Atlas_Button'
            aria-label={`Switch to ${
              state.scheme == 'dark' ? 'light' : 'dark'
            } mode`}
            title={`Switch to ${
              state.scheme == 'dark' ? 'light' : 'dark'
            } mode`}
            onClick={() =>
              model.set({ scheme: state.scheme == 'dark' ? 'light' : 'dark' })}
          >
            <span aria-hidden='true'>{state.scheme == 'dark' ? '☼' : '◐'}</span>
          </Button>
        </div>
      </header>
      <main className='Atlas_Main'>
        <section className='Atlas_Intro' aria-labelledby='atlas-title'>
          <div className='Atlas_Heading'>
            <span className='Atlas_Eyebrow'>Structure × causality</span>
            <h1 className='Atlas_Reset Atlas_Heading_Title' id='atlas-title'>
              The platform,{' '}
              <em className='Atlas_Heading_Emphasis'>in focus.</em>
            </h1>
            <p className='Atlas_Reset Atlas_Heading_Description'>
              Its parts. Their connections. The work moving through them.
            </p>
          </div>
          <dl
            className='Atlas_Metrics Atlas_Reset'
            aria-label='Anatomy snapshot summary'
          >
            {[
              [parts.length, 'reported parts'],
              [loaded, 'loaded'],
              [bound, 'bound'],
              [model.edges.length, 'relationships'],
            ].map(([number, label]) => (
              <div className='Atlas_Metrics_Row' key={label}>
                <dt className='Atlas_Metrics_Term'>{label}</dt>
                <dd className='Atlas_Metrics_Value'>{number}</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className='Atlas_Coverage' role='note'>
          <Chip className='Atlas_Scope' style={{ '--hue': 'var(--info)' }}>
            Process-local
          </Chip>
          <p className='Atlas_Reset Atlas_Coverage_Description'>
            Composition and activity of this host only. Recording exists while
            subscribed; other processes and unobserved intervals are not
            represented.
          </p>
          <span className='Atlas_Safety'>
            Names & contracts. No entity or secret values.
          </span>
        </div>
        {unobserved.length > 0 && (
          <details className='Atlas_Unobserved'>
            <summary className='Atlas_Summary Atlas_Unobserved_Summary'>
              {unobserved.length} categories unobserved here
            </summary>
            <p className='Atlas_Reset Atlas_Unobserved_Description'>
              {unobserved.join(' · ')}
            </p>
            <p className='Atlas_Reset Atlas_Unobserved_Description'>
              An empty unobserved category is not evidence that its parts are
              absent.
            </p>
          </details>
        )}
        {(state.error || state.gap > 0 || state.paused) && (
          <section
            className='Atlas_Notices'
            aria-label='Connection and recording notices'
          >
            {state.error && (
              <div className='Atlas_Notice' data-tone='negative' role='alert'>
                <strong className='Atlas_Notice_Strong'>
                  Connection needs attention.
                </strong>
                <span className='Atlas_Notice_Text'>{state.error}</span>
                <Button
                  className='Atlas_Button'
                  type='button'
                  onClick={() =>
                    void model.refresh()}
                >
                  Retry anatomy
                </Button>
              </div>
            )}
            {state.gap > 0 && (
              <div className='Atlas_Notice' data-tone='caution' role='status'>
                <strong className='Atlas_Notice_Strong'>
                  Observation gaps ({state.gap})
                </strong>
                <span className='Atlas_Notice_Text'>
                  Pauses, epoch changes or known omissions broke continuity.
                  This counts episodes, not missed records. Disconnection alone
                  does not prove record loss.
                </span>
              </div>
            )}
            {state.paused && (
              <div className='Atlas_Notice' data-tone='muted' role='status'>
                <strong className='Atlas_Notice_Strong'>
                  Recording paused.
                </strong>
                <span className='Atlas_Notice_Text'>
                  Retained observations and anatomy remain available. New work
                  during the pause is not reconstructed.
                </span>
              </div>
            )}
          </section>
        )}
        <Spine model={model} />
        <section
          className='Atlas_Workspace Atlas_Focusable'
          id='atlas-workspace'
          tabIndex={-1}
          aria-label='Explore system anatomy'
        >
          <div className='Atlas_Toolbar'>
            <div className='Atlas_Search'>
              <svg
                className='Atlas_Search_Icon'
                viewBox='0 0 20 20'
                aria-hidden='true'
              >
                <circle cx='8' cy='8' r='5' />
                <path d='m12 12 5 5' />
              </svg>
              <Field
                className='Atlas_SearchField Atlas_Input'
                elRef={search}
                type='search'
                aria-label='Search anatomy by name, package or description'
                placeholder='Find a part, package or mechanism…'
                value={state.filter}
                autoComplete='off'
                spellCheck={false}
                onInput={(event: Event) => {
                  model.search((event.currentTarget as HTMLInputElement).value)
                  model.set({ listPage: 0 })
                }}
              />
              {state.filter
                ? (
                  <Button
                    className='Atlas_Button'
                    type='button'
                    mod='quiet'
                    aria-label='Clear anatomy search'
                    onClick={() => {
                      model.search('')
                      model.set({ listPage: 0 })
                      search.current?.focus()
                    }}
                  >
                    ×
                  </Button>
                )
                : <kbd className='Atlas_Key'>/</kbd>}
            </div>
            <label className='Atlas_Group'>
              <span className='Atlas_VisuallyHidden'>Anatomy group</span>
              <select
                className='Atlas_Select Atlas_Group_Select'
                value={state.group || 'all'}
                aria-label='Filter anatomy group'
                onChange={(event) => changeGroup(event.currentTarget.value)}
              >
                <option value='all'>All anatomy</option>
                {sections.map((section) => (
                  <optgroup key={section.id} label={section.name}>
                    {section.groups.map((group) => (
                      <option key={group} value={group}>
                        {groupName(group)} ({counts.get(group) ?? 0})
                        {model.coverage[group] === false && ' · unobserved'}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value='relations'>
                  Relationships ({model.edges.length})
                </option>
              </select>
            </label>
            <div className='Atlas_Views' role='group' aria-label='Anatomy view'>
              <Button
                className='Atlas_Button Atlas_Views_Button'
                type='button'
                aria-pressed={state.view == 'map'}
                onClick={map}
              >
                <span aria-hidden='true'>⌘</span> Map
              </Button>
              <Button
                className='Atlas_Button Atlas_Views_Button'
                type='button'
                aria-pressed={state.view == 'list'}
                onClick={() => model.set({ view: 'list' })}
              >
                <span aria-hidden='true'>☷</span> List
              </Button>
            </div>
            <Button
              type='button'
              className='Atlas_Refresh Atlas_Button'
              mod='quiet'
              aria-label='Refresh host anatomy'
              title='Refresh host anatomy'
              onClick={() => void model.refresh()}
            >
              ↻
            </Button>
          </div>
          <div className='Atlas_FilterSummary'>
            <span>
              {shown} matching{' '}
              {state.group == 'relations' ? 'relationships' : 'parts'}
              {state.filter && (
                <>
                  for{' '}
                  <strong className='Atlas_FilterSummary_Strong'>
                    “{state.filter}”
                  </strong>
                </>
              )}
            </span>
            {unattempted > 0 && (
              <span>{unattempted} unattempted facets ≠ absent</span>
            )}
            <Shortcuts />
          </div>
          <div className='Atlas_Anatomy'>
            {state.view == 'list' || state.group == 'relations'
              ? <AnatomyList model={model} />
              : <Topology model={model} />}
            <Detail model={model} />
          </div>
        </section>
        <ActivityView model={model} />
        <footer className='Atlas_Footer'>
          <span>
            <strong className='Atlas_Footer_Strong'>@yaks/visualize</strong>
            {' '}
            · Anatomy is declaration, not execution.
          </span>
          <span>
            Actual observations only · no polling clock · bounded history
          </span>
        </footer>
      </main>
    </div>
  )
}
