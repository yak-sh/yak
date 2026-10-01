/** A process-local system MRI. The model owns navigation, filters, camera and
 * playback; this surface owns only layout, focus and display-only kit parts.
 */

import { useRef } from 'preact/hooks'
import { Button, Chip, Field } from '@yaks/ui'
import type { AtlasModel } from './model.ts'
import { ActivityView } from './ActivityView.tsx'
import { AnatomyList, matchingEdges, PAGE_SIZE } from './AnatomyList.tsx'
import { Detail } from './Detail.tsx'
import {
  filtered, groupName, mapParts, sections, Spine, Topology, zoomed,
} from './Topology.tsx'

let connectionNames: Record<string, string> = {
  connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting',
  paused: 'Paused', offline: 'Offline',
}

let Mark = () => <svg class="Atlas_Mark" viewBox="0 0 40 40" aria-hidden="true">
  <rect x="3" y="3" width="34" height="34" rx="9" />
  <path d="M7 20h7l3-7 5 15 4-8h7" />
  <circle cx="20" cy="20" r="13" />
</svg>

let Shortcuts = () => <details class="Atlas_Shortcuts">
  <summary>Keyboard <kbd>?</kbd></summary>
  <dl>
    {[
      ['/', 'Focus search'], ['↑ / ↓', 'Select a part'],
      ['Enter', 'Focus selected detail'], ['+ / −', 'Zoom map'],
      ['0', 'Fit map'], ['P', 'Pause / resume'], ['L / M', 'List / map'],
      ['Esc', 'Clear selection'],
    ].map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt>
      <dd>{action}</dd></div>)}
  </dl>
</details>

export let Atlas = ({ model }: { model: AtlasModel }) => {
  let state = model.state
  let search = useRef<HTMLInputElement>(null)
  let root = useRef<HTMLDivElement>(null)
  let groups = sections.flatMap((section) => section.groups)
  let counts = new Map(groups.map((group) =>
    [group, model.nodes.filter((node) => node.group == group).length]))
  let parts = model.nodes.filter((node) => node.group != 'phases')
  let loaded = parts.filter((node) => node.loaded).length
  let bound = parts.filter((node) => node.bound).length
  let unattempted = parts.filter((node) =>
    node.group == 'facets' && node.detail.attempted === false).length
  let unobserved = Object.entries(model.coverage)
    .filter(([, observed]) => !observed).map(([group]) => groupName(group))
  let shown = state.group == 'relations' ? matchingEdges(model).length
    : state.view == 'map' ? mapParts(model).length : filtered(model).length
  let connection = state.paused ? 'paused' : state.connected
  let changeGroup = (group: string) => model.set({
    group, listPage: 0, ...(['relations', 'phases'].includes(group) &&
      { view: 'list' as const }),
  })
  let map = () => model.set({
    view: 'map', ...(['relations', 'phases'].includes(state.group) &&
      { group: 'all' }),
  })
  let press = (event: KeyboardEvent) => {
    let target = event.target as Element
    if (event.altKey || event.ctrlKey || event.metaKey ||
      target.closest('input,textarea,select,[contenteditable="true"]')) return
    let key = event.key.toLocaleLowerCase()
    if (key == '/') {
      event.preventDefault()
      search.current?.focus()
      return
    }
    if (key == 'arrowdown' || key == 'arrowup') {
      event.preventDefault()
      let ids = state.group == 'relations' ? matchingEdges(model).map((e) => e.id)
        : (state.view == 'map' ? mapParts(model) : filtered(model))
          .map((node) => node.id)
      if (!ids.length) return
      let at = ids.indexOf(state.selected)
      let index = at < 0 ? key == 'arrowdown' ? 0 : ids.length - 1
        : Math.max(0, Math.min(ids.length - 1,
          at + (key == 'arrowdown' ? 1 : -1)))
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
      let shortcuts = root.current?.querySelector<HTMLDetailsElement>('.Atlas_Shortcuts')
      if (shortcuts) shortcuts.open = !shortcuts.open
    }
  }
  return <div class="Atlas" ref={root} onKeyDown={press}
    data-paused={state.paused} data-theme={state.theme} data-scheme={state.scheme}
    style={{ colorScheme: state.scheme }}>
    <a href="#atlas-workspace" class="Atlas_Skip">Skip to anatomy</a>
    <header class="Atlas_Header" data-ready={Boolean(state.host)}>
      <div class="Atlas_Brand"><Mark /><div><strong>visualize</strong>
        <span>@yaks / system MRI</span></div></div>
      <div class="Atlas_Host"><span class="Atlas_Eyebrow">Connected process</span>
        <span title={state.host || 'Waiting for host anatomy'}>
          {state.host || 'Awaiting anatomy…'}
        </span></div>
      <div class="Atlas_HeaderControls">
        <span class="Atlas_Connection" data-connection={connection} role="status">
          <i aria-hidden="true" />{connectionNames[connection] ?? connection}
        </span>
        <Button type="button" class="Atlas_Pause" aria-pressed={state.paused}
          title="Pause or resume recording (P)"
          onClick={() => model.set({ paused: !state.paused })}>
          <span aria-hidden="true">{state.paused ? '▷' : 'Ⅱ'}</span>
          {state.paused ? 'Resume' : 'Pause'}
        </Button>
        <label class="Atlas_Theme"><span class="Atlas_VisuallyHidden">Color theme</span>
          <select value={state.theme} aria-label="Color theme"
            onChange={(event) => model.set({
              theme: event.currentTarget.value as 'everforest' | 'rosepine',
            })}>
            <option value="everforest">Everforest</option>
            <option value="rosepine">Rosé Pine</option>
          </select></label>
        <Button type="button" class="Atlas_Scheme"
          aria-label={`Switch to ${state.scheme == 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${state.scheme == 'dark' ? 'light' : 'dark'} mode`}
          onClick={() => model.set({ scheme: state.scheme == 'dark' ? 'light' : 'dark' })}>
          <span aria-hidden="true">{state.scheme == 'dark' ? '☼' : '◐'}</span>
        </Button>
      </div>
    </header>
    <main class="Atlas_Main">
      <section class="Atlas_Intro" aria-labelledby="atlas-title">
        <div class="Atlas_Heading">
          <span class="Atlas_Eyebrow">Structure × causality</span>
          <h1 id="atlas-title">The platform, <em>in focus.</em></h1>
          <p>Its parts. Their connections. The work moving through them.</p>
        </div>
        <dl class="Atlas_Metrics" aria-label="Anatomy snapshot summary">
          {[
            [parts.length, 'reported parts'], [loaded, 'loaded'],
            [bound, 'bound'], [model.edges.length, 'relationships'],
          ].map(([number, label]) => <div key={label}>
            <dt>{label}</dt><dd>{number}</dd>
          </div>)}
        </dl>
      </section>
      <div class="Atlas_Coverage" role="note">
        <Chip class="Atlas_Scope" style={{ '--hue': 'var(--info)' }}>Process-local</Chip>
        <p>Composition and activity of this host only. Recording exists while
          subscribed; other processes and unobserved intervals are not represented.</p>
        <span class="Atlas_Safety">Names & contracts. No entity or secret values.</span>
      </div>
      {unobserved.length > 0 && <details class="Atlas_Unobserved">
        <summary>{unobserved.length} categories unobserved here</summary>
        <p>{unobserved.join(' · ')}</p>
        <p>An empty unobserved category is not evidence that its parts are absent.</p>
      </details>}
      {(state.error || state.gap > 0 || state.paused) && <section class="Atlas_Notices"
        aria-label="Connection and recording notices">
        {state.error && <div class="Atlas_Notice" data-tone="negative" role="alert">
          <strong>Connection needs attention.</strong><span>{state.error}</span>
          <Button type="button" onClick={() => void model.refresh()}>Retry anatomy</Button>
        </div>}
        {state.gap > 0 && <div class="Atlas_Notice" data-tone="caution" role="status">
          <strong>Observation gaps ({state.gap})</strong>
          <span>Pauses, epoch changes or known omissions broke continuity.
            This counts episodes, not missed records. Disconnection alone does
            not prove record loss.</span>
        </div>}
        {state.paused && <div class="Atlas_Notice" data-tone="muted" role="status">
          <strong>Recording paused.</strong>
          <span>Retained observations and anatomy remain available.
            New work during the pause is not reconstructed.</span>
        </div>}
      </section>}
      <Spine model={model} />
      <section class="Atlas_Workspace" id="atlas-workspace" tabIndex={-1}
        aria-label="Explore system anatomy">
        <div class="Atlas_Toolbar">
          <div class="Atlas_Search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5" />
              <path d="m12 12 5 5" /></svg>
            <Field class="Atlas_SearchField" elRef={search} type="search"
              aria-label="Search anatomy by name, package or description"
              placeholder="Find a part, package or mechanism…"
              value={state.filter} autoComplete="off" spellCheck={false}
              onInput={(event: Event) => {
                model.search((event.currentTarget as HTMLInputElement).value)
                model.set({ listPage: 0 })
              }} />
            {state.filter ? <Button type="button" mod="quiet" aria-label="Clear anatomy search"
              onClick={() => {
                model.search('')
                model.set({ listPage: 0 })
                search.current?.focus()
              }}>×</Button> : <kbd>/</kbd>}
          </div>
          <label class="Atlas_Group"><span class="Atlas_VisuallyHidden">Anatomy group</span>
            <select value={state.group || 'all'} aria-label="Filter anatomy group"
              onChange={(event) => changeGroup(event.currentTarget.value)}>
              <option value="all">All anatomy</option>
              {sections.map((section) => <optgroup key={section.id} label={section.name}>
                {section.groups.map((group) => <option key={group} value={group}>
                  {groupName(group)} ({counts.get(group) ?? 0})
                  {model.coverage[group] === false && ' · unobserved'}
                </option>)}
              </optgroup>)}
              <option value="relations">Relationships ({model.edges.length})</option>
            </select></label>
          <div class="Atlas_Views" role="group" aria-label="Anatomy view">
            <Button type="button" aria-pressed={state.view == 'map'}
              onClick={map}><span aria-hidden="true">⌘</span> Map</Button>
            <Button type="button" aria-pressed={state.view == 'list'}
              onClick={() => model.set({ view: 'list' })}>
              <span aria-hidden="true">☷</span> List</Button>
          </div>
          <Button type="button" class="Atlas_Refresh" mod="quiet"
            aria-label="Refresh host anatomy" title="Refresh host anatomy"
            onClick={() => void model.refresh()}>↻</Button>
        </div>
        <div class="Atlas_FilterSummary">
          <span>{shown} matching {state.group == 'relations' ? 'relationships' : 'parts'}
            {state.filter && <> for <strong>“{state.filter}”</strong></>}</span>
          {unattempted > 0 && <span>{unattempted} unattempted facets ≠ absent</span>}
          <Shortcuts />
        </div>
        <div class="Atlas_Anatomy">
          {state.view == 'list' || state.group == 'relations'
            ? <AnatomyList model={model} /> : <Topology model={model} />}
          <Detail model={model} />
        </div>
      </section>
      <ActivityView model={model} />
      <footer class="Atlas_Footer">
        <span><strong>@yaks/visualize</strong> · Anatomy is declaration, not execution.</span>
        <span>Actual observations only · no polling clock · bounded history</span>
      </footer>
    </main>
  </div>
}
