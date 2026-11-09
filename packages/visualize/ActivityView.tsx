/** @jsxImportSource preact */
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
      <dl class='Activity_Counts Atlas_Reset'>
        {values.slice(0, 12).map(([name, count]) => (
          <div class='Activity_Counts_Row' key={name}>
            <dt class='Activity_Counts_Term'>{name}</dt>
            <dd class='Activity_Counts_Value'>{count}</dd>
          </div>
        ))}
        {values.length > 12 && (
          <div class='Activity_Counts_Row'>
            <dt class='Activity_Counts_Term'>additional counters</dt>
            <dd class='Activity_Counts_Value'>{values.length - 12}</dd>
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
      class='Cause Atlas_Focusable'
      id='atlas-cause'
      tabIndex={-1}
      aria-label='Selected causal path'
    >
      <header class='Activity_Header'>
        <div>
          <span class='Atlas_Eyebrow'>Causality</span>
          <h2 class='Atlas_Reset Activity_Header_Title'>Follow the work</h2>
        </div>
        {model.state.cause && (
          <Button
            class='Atlas_Button'
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
          <div class='Cause_Empty'>
            <span class='Cause_EmptyMark' aria-hidden='true'>↳</span>
            <h3 class='Atlas_Reset Cause_Empty_Title'>
              {model.state.cause
                ? 'Outside the retained window'
                : 'What caused this?'}
            </h3>
            <p class='Atlas_Reset Cause_Empty_Description'>
              {model.state.cause
                ? 'The selected span is no longer retained. Choose another observation.'
                : 'Choose an observation to reveal its ancestors and descendants. No activity is invented when the process is quiet.'}
            </p>
          </div>
        )
        : (
          <div class='Cause_Body'>
            <div class='Cause_Identity' data-outcome={selected.outcome}>
              <div class='Cause_Tokens'>
                <Chip class='Cause_Tokens_Text'>{selected.kind}</Chip>
                <span class='Cause_Tokens_Text'>{outcome(selected)}</span>
              </div>
              <h3 class='Atlas_Reset Cause_Identity_Title'>{selected.name}</h3>
              <div class='Cause_Measure'>
                <strong class='Cause_Measure_Strong'>
                  {elapsed(selected)}
                </strong>
                <span class='Cause_Measure_Text'>
                  {selected.stage == 'start'
                    ? 'unfinished span'
                    : selected.duration == undefined
                    ? 'instant observation'
                    : 'observed duration'}
                </span>
              </div>
            </div>
            {(selected.package || selected.plugin) && (
              <dl class='Cause_Provenance Atlas_Reset'>
                {selected.package && (
                  <div class='Cause_Provenance_Row'>
                    <dt class='Cause_Provenance_Term'>Package</dt>
                    <dd class='Cause_Provenance_Value'>{selected.package}</dd>
                  </div>
                )}
                {selected.plugin && (
                  <div class='Cause_Provenance_Row'>
                    <dt class='Cause_Provenance_Term'>Plugin</dt>
                    <dd class='Cause_Provenance_Value'>{selected.plugin}</dd>
                  </div>
                )}
              </dl>
            )}
            <Counts event={selected} />
            <p class='Cause_ClockNote Atlas_Reset'>
              A recorded 0 ms is valid. Some runtime clocks advance only with
              I/O; counts carry information too.
            </p>
            <div class='Cause_Actions'>
              {selected.node && (
                <Button
                  class='Atlas_Button'
                  type='button'
                  onClick={() => model.select(selected.node!)}
                >
                  Locate part ↗
                </Button>
              )}
              {parent && (
                <Button
                  class='Atlas_Button'
                  type='button'
                  mod='quiet'
                  onClick={() => model.choose(parent.id)}
                >
                  Parent span ↑
                </Button>
              )}
            </div>
            <div class='Cause_PathHead'>
              <h3 class='Atlas_Reset Cause_PathHead_Title'>Causal path</h3>
              <span class='Cause_PathHead_Text'>
                {related.length} retained spans
              </span>
            </div>
            <ol class='Cause_Path Atlas_Reset'>
              {related.map((event) => (
                <li
                  class='Cause_Path_Item'
                  key={`${event.epoch}:${event.id}`}
                  style={{ '--depth': Math.min(5, depthOf(event, related)) }}
                >
                  <button
                    type='button'
                    class='Cause_Span Atlas_Button'
                    data-selected={event.id == selected.id}
                    data-outcome={event.outcome}
                    onClick={() => model.choose(event.id)}
                  >
                    <span class='Cause_Branch' aria-hidden='true'>↳</span>
                    <span class='Cause_SpanName'>
                      <small class='Cause_SpanName_Note'>{event.kind}</small>
                      {event.name}
                    </span>
                    <span class='Cause_SpanTime'>{elapsed(event)}</span>
                  </button>
                </li>
              ))}
            </ol>
            {(clipped || selected.parent && !parent) && (
              <p class='Cause_Notice Atlas_Reset'>
                An ancestor is outside this process's retained window. This is
                not a complete distributed trace.
              </p>
            )}
            <details class='Cause_Identifiers'>
              <summary class='Atlas_Summary Cause_Identifiers_Summary'>
                Span identifier
              </summary>
              <code class='Cause_Identifiers_Code'>{selected.id}</code>
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
    <section class='Activity' aria-label='Process activity and causality'>
      <div class='Activity_Stream'>
        <header class='Activity_Header'>
          <div>
            <span class='Atlas_Eyebrow'>Live flow</span>
            <h2 class='Atlas_Reset Activity_Header_Title'>Process activity</h2>
          </div>
          <div class='Activity_Summary'>
            <span>
              {events.length} spans · {model.events.length}/256 records
            </span>
            {failed > 0 && <span class='Activity_Failed'>{failed} non-ok</span>}
          </div>
        </header>
        <div class='Activity_Guide'>
          <span>Newest first · offsets from latest record</span>
          <span>
            {model.state.paused ? 'Recording paused' : 'Subscriber-only'}
          </span>
        </div>
        {!events.length
          ? (
            <div class='Activity_Empty'>
              <svg
                class='Activity_Empty_Icon'
                viewBox='0 0 220 58'
                aria-hidden='true'
              >
                <path d='M0 29h60l12-8 14 16 14-32 14 48 14-24h92' />
              </svg>
              <h3 class='Atlas_Reset Activity_Empty_Title'>
                {model.state.connected == 'live'
                  ? 'Quiet is a real signal.'
                  : 'Waiting for the process.'}
              </h3>
              <p class='Atlas_Reset Activity_Empty_Description'>
                {model.state.connected == 'live'
                  ? 'No activity observed in this subscriber window. Anatomy is still available; execute real work to see a causal path.'
                  : 'Anatomy and activity come from the connected host. No sample traffic, timings or synthetic pulses are shown.'}
              </p>
            </div>
          )
          : (
            <div
              class='Activity_Window Atlas_Focusable'
              tabIndex={0}
              aria-label='Retained activity, scroll for older spans'
            >
              <Timeline class='Activity_Timeline Atlas_Reset'>
                {events.map((event) => (
                  <Timeline.Item
                    key={`${event.epoch}:${event.id}`}
                    class='Activity_Item'
                    data-selected={model.state.cause == event.id}
                    data-outcome={event.outcome}
                    style={{
                      '--event': `var(--${tones[event.kind] ?? 'muted'})`,
                    }}
                  >
                    <button
                      type='button'
                      class='Activity_Row Atlas_Button'
                      aria-pressed={model.state.cause == event.id}
                      aria-label={`${event.kind}: ${event.name}, ${
                        outcome(event)
                      }, ${elapsed(event)}`}
                      onClick={() => {
                        model.choose(event.id)
                        if (event.node) model.select(event.node)
                      }}
                    >
                      <span class='Activity_Dot' aria-hidden='true' />
                      <div class='Activity_RowText'>
                        <div class='Activity_RowMeta'>
                          <Timeline.When class='Activity_When'>
                            {offset(event, latest)}
                          </Timeline.When>
                          <Timeline.Who class='Activity_Kind'>
                            {event.kind}
                          </Timeline.Who>
                          <span class='Activity_Outcome'>{outcome(event)}</span>
                        </div>
                        <Timeline.What class='Activity_Name'>
                          {event.name}
                        </Timeline.What>
                      </div>
                      <span class='Activity_Duration'>{elapsed(event)}</span>
                      <span class='Activity_Arrow' aria-hidden='true'>↗</span>
                    </button>
                  </Timeline.Item>
                ))}
              </Timeline>
            </div>
          )}
        <footer class='Activity_Footer'>
          Bounded to 256 records in this page. Start/end records share one span.
          Gaps and omitted history are not reconstructed.
        </footer>
      </div>
      <Cause model={model} />
    </section>
  )
}
