/** @jsxImportSource react */
/** One bounded trace stream, presented as spans. Begin/end records share an
 * identity; a selected cause is that span identity, never a graph row id.
 */

import { Button, Chip, Timeline } from '@yaks/ui'
import type { Activity, AtlasModel } from './model.ts'
import { elapsed } from './Topology.tsx'

// The model clears history and cause on epoch change, so these span IDs
// are compared only within one retained recording. Offsets never use a clock.
export let spanEvents = (events: readonly Activity[]) => {
  let spans = new Map<string, { event: Activity; at: number }>()
  events.forEach((event, at) => spans.set(event.id, { event, at }))
  return [...spans.values()].sort((a, b) => b.at - a.at)
    .map(({ event }) => event)
}

let tones: Record<string, string> = {
  apply: 'accent',
  phase: 'active',
  rule: 'active',
  effect: 'special',
  query: 'info',
  get: 'info',
  request: 'link',
  fanout: 'positive',
}

let offset = (event: Activity, latest: number) => {
  let difference = Math.max(0, latest - event.time)
  if (!difference) return 'latest'
  return difference < 1000
    ? `−${difference.toFixed(0)} ms`
    : `−${(difference / 1000).toFixed(1)} s`
}

let outcome = (event: Activity) =>
  event.outcome ??
    (event.stage == 'start' ? 'in flight' : 'observed')

let Counts = ({ event }: { event: Activity }) => {
  let values = Object.entries(event.counts ?? {}).filter(([, count]) =>
    typeof count == 'number' && Number.isFinite(count)
  )
  return values.length
    ? (
      <dl className='Activity_Counts Atlas_Reset'>
        {values.slice(0, 12).map(([name, count]) => (
          <div className='Activity_Counts_Row' key={name}>
            <dt className='Activity_Counts_Term'>{name}</dt>
            <dd className='Activity_Counts_Value'>{count}</dd>
          </div>
        ))}
        {values.length > 12 && (
          <div className='Activity_Counts_Row'>
            <dt className='Activity_Counts_Term'>additional counters</dt>
            <dd className='Activity_Counts_Value'>{values.length - 12}</dd>
          </div>
        )}
      </dl>
    )
    : null
}

let depthOf = (event: Activity, events: Activity[]) => {
  let byId = new Map(events.map((event) => [event.id, event]))
  let seen = new Set([event.id])
  let depth = 0, parent = event.parent
  while (parent && byId.has(parent) && !seen.has(parent) && depth < 12) {
    seen.add(parent)
    depth++
    parent = byId.get(parent)?.parent
  }
  return depth
}

/** A missing parent is outside the retained window, not evidence of no cause. */
let Cause = ({ model }: { model: AtlasModel }) => {
  let related = spanEvents(model.cause).reverse()
  let events = spanEvents(model.events)
  let selected = events.find((event) => event.id == model.state.cause) ??
    related.find((event) => event.id == model.state.cause)
  let parent = selected?.parent
    ? events.find((event) => event.id == selected.parent)
    : undefined
  let known = new Set(related.map((event) => event.id))
  let clipped = related.some((event) =>
    event.parent && !known.has(event.parent)
  )
  return (
    <section
      className='Cause Atlas_Focusable'
      id='atlas-cause'
      tabIndex={-1}
      aria-label='Selected causal path'
    >
      <header className='Activity_Header'>
        <div>
          <span className='Atlas_Eyebrow'>Causality</span>
          <h2 className='Atlas_Reset Activity_Header_Title'>Follow the work</h2>
        </div>
        {model.state.cause && (
          <Button
            className='Atlas_Button'
            type='button'
            mod='quiet'
            aria-label='Clear selected cause'
            onClick={() => model.choose('')}
          >
            ×
          </Button>
        )}
      </header>
      {!selected
        ? (
          <div className='Cause_Empty'>
            <span className='Cause_EmptyMark' aria-hidden='true'>↳</span>
            <h3 className='Atlas_Reset Cause_Empty_Title'>
              {model.state.cause
                ? 'Outside the retained window'
                : 'What caused this?'}
            </h3>
            <p className='Atlas_Reset Cause_Empty_Description'>
              {model.state.cause
                ? 'The selected span is no longer retained. Choose another observation.'
                : 'Choose an observation to reveal its ancestors and descendants. No activity is invented when the process is quiet.'}
            </p>
          </div>
        )
        : (
          <div className='Cause_Body'>
            <div className='Cause_Identity' data-outcome={selected.outcome}>
              <div className='Cause_Tokens'>
                <Chip className='Cause_Tokens_Text'>{selected.kind}</Chip>
                <span className='Cause_Tokens_Text'>{outcome(selected)}</span>
              </div>
              <h3 className='Atlas_Reset Cause_Identity_Title'>
                {selected.name}
              </h3>
              <div className='Cause_Measure'>
                <strong className='Cause_Measure_Strong'>
                  {elapsed(selected)}
                </strong>
                <span className='Cause_Measure_Text'>
                  {selected.stage == 'start'
                    ? 'unfinished span'
                    : selected.duration == undefined
                    ? 'instant observation'
                    : 'observed duration'}
                </span>
              </div>
            </div>
            {(selected.package || selected.plugin) && (
              <dl className='Cause_Provenance Atlas_Reset'>
                {selected.package && (
                  <div className='Cause_Provenance_Row'>
                    <dt className='Cause_Provenance_Term'>Package</dt>
                    <dd className='Cause_Provenance_Value'>
                      {selected.package}
                    </dd>
                  </div>
                )}
                {selected.plugin && (
                  <div className='Cause_Provenance_Row'>
                    <dt className='Cause_Provenance_Term'>Plugin</dt>
                    <dd className='Cause_Provenance_Value'>
                      {selected.plugin}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            <Counts event={selected} />
            <p className='Cause_ClockNote Atlas_Reset'>
              A recorded 0 ms is valid. Some runtime clocks advance only with
              I/O; counts carry information too.
            </p>
            <div className='Cause_Actions'>
              {selected.node && (
                <Button
                  className='Atlas_Button'
                  type='button'
                  onClick={() => model.select(selected.node!)}
                >
                  Locate part ↗
                </Button>
              )}
              {parent && (
                <Button
                  className='Atlas_Button'
                  type='button'
                  mod='quiet'
                  onClick={() => model.choose(parent.id)}
                >
                  Parent span ↑
                </Button>
              )}
            </div>
            <div className='Cause_PathHead'>
              <h3 className='Atlas_Reset Cause_PathHead_Title'>Causal path</h3>
              <span className='Cause_PathHead_Text'>
                {related.length} retained spans
              </span>
            </div>
            <ol className='Cause_Path Atlas_Reset'>
              {related.map((event) => (
                <li
                  className='Cause_Path_Item'
                  key={`${event.epoch}:${event.id}`}
                  style={{ '--depth': Math.min(5, depthOf(event, related)) }}
                >
                  <button
                    type='button'
                    className='Cause_Span Atlas_Button'
                    data-selected={event.id == selected.id}
                    data-outcome={event.outcome}
                    onClick={() => model.choose(event.id)}
                  >
                    <span className='Cause_Branch' aria-hidden='true'>↳</span>
                    <span className='Cause_SpanName'>
                      <small className='Cause_SpanName_Note'>
                        {event.kind}
                      </small>
                      {event.name}
                    </span>
                    <span className='Cause_SpanTime'>{elapsed(event)}</span>
                  </button>
                </li>
              ))}
            </ol>
            {(clipped || selected.parent && !parent) && (
              <p className='Cause_Notice Atlas_Reset'>
                An ancestor is outside this process's retained window. This is
                not a complete distributed trace.
              </p>
            )}
            <details className='Cause_Identifiers'>
              <summary className='Atlas_Summary Cause_Identifiers_Summary'>
                Span identifier
              </summary>
              <code className='Cause_Identifiers_Code'>{selected.id}</code>
            </details>
          </div>
        )}
    </section>
  )
}

/** Newest first, without a ticking clock or auto-scroll that steals focus. */
export let ActivityView = ({ model }: { model: AtlasModel }) => {
  let events = spanEvents(model.events)
  let latest = model.events.at(-1)?.time ?? 0
  let failed =
    events.filter((event) =>
      ['error', 'refused', 'interrupted'].includes(event.outcome ?? '')
    ).length
  return (
    <section className='Activity' aria-label='Process activity and causality'>
      <div className='Activity_Stream'>
        <header className='Activity_Header'>
          <div>
            <span className='Atlas_Eyebrow'>Live flow</span>
            <h2 className='Atlas_Reset Activity_Header_Title'>
              Process activity
            </h2>
          </div>
          <div className='Activity_Summary'>
            <span>
              {events.length} spans · {model.events.length}/256 records
            </span>
            {failed > 0 && (
              <span className='Activity_Failed'>{failed} non-ok</span>
            )}
          </div>
        </header>
        <div className='Activity_Guide'>
          <span>Newest first · offsets from latest record</span>
          <span>
            {model.state.paused ? 'Recording paused' : 'Subscriber-only'}
          </span>
        </div>
        {!events.length
          ? (
            <div className='Activity_Empty'>
              <svg
                className='Activity_Empty_Icon'
                viewBox='0 0 220 58'
                aria-hidden='true'
              >
                <path d='M0 29h60l12-8 14 16 14-32 14 48 14-24h92' />
              </svg>
              <h3 className='Atlas_Reset Activity_Empty_Title'>
                {model.state.connected == 'live'
                  ? 'Quiet is a real signal.'
                  : 'Waiting for the process.'}
              </h3>
              <p className='Atlas_Reset Activity_Empty_Description'>
                {model.state.connected == 'live'
                  ? 'No activity observed in this subscriber window. Anatomy is still available; execute real work to see a causal path.'
                  : 'Anatomy and activity come from the connected host. No sample traffic, timings or synthetic pulses are shown.'}
              </p>
            </div>
          )
          : (
            <div
              className='Activity_Window Atlas_Focusable'
              tabIndex={0}
              aria-label='Retained activity, scroll for older spans'
            >
              <Timeline className='Activity_Timeline Atlas_Reset'>
                {events.map((event) => (
                  <Timeline.Item
                    key={`${event.epoch}:${event.id}`}
                    className='Activity_Item'
                    data-selected={model.state.cause == event.id}
                    data-outcome={event.outcome}
                    style={{
                      '--event': `var(--${tones[event.kind] ?? 'muted'})`,
                    }}
                  >
                    <button
                      type='button'
                      className='Activity_Row Atlas_Button'
                      aria-pressed={model.state.cause == event.id}
                      aria-label={`${event.kind}: ${event.name}, ${
                        outcome(event)
                      }, ${elapsed(event)}`}
                      onClick={() => {
                        model.choose(event.id)
                        if (event.node) model.select(event.node)
                      }}
                    >
                      <span className='Activity_Dot' aria-hidden='true' />
                      <div className='Activity_RowText'>
                        <div className='Activity_RowMeta'>
                          <Timeline.When className='Activity_When'>
                            {offset(event, latest)}
                          </Timeline.When>
                          <Timeline.Who className='Activity_Kind'>
                            {event.kind}
                          </Timeline.Who>
                          <span className='Activity_Outcome'>
                            {outcome(event)}
                          </span>
                        </div>
                        <Timeline.What className='Activity_Name'>
                          {event.name}
                        </Timeline.What>
                      </div>
                      <span className='Activity_Duration'>
                        {elapsed(event)}
                      </span>
                      <span className='Activity_Arrow' aria-hidden='true'>
                        ↗
                      </span>
                    </button>
                  </Timeline.Item>
                ))}
              </Timeline>
            </div>
          )}
        <footer className='Activity_Footer'>
          Bounded to 256 records in this page. Start/end records share one span.
          Gaps and omitted history are not reconstructed.
        </footer>
      </div>
      <Cause model={model} />
    </section>
  )
}
