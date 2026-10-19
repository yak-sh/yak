/** @jsxImportSource preact */
// Sessions exposes the follower's existing graph mute. Loading deployment
// metadata never holds a second copy of the person's on/off choice.
import { useEffect, useState } from 'preact/hooks'
import type { Io, Props } from '@yaks/inspect'
import { Button, Loading, Section } from '@yaks/ui'
import type { Control } from './routes.ts'

/** The persisted switch, drawn from the same home-project mark heal reads. */
export let AutoSpawn = (
  { io, control }: { io: Io; control: Control },
) => {
  let [error, setError] = useState<string>()
  let { project, configured } = control
  let { home } = io.ask(
    project ? { home: `.entity.eid=${project} ?nofix` } : {},
  )
  let row = home?.rows[0]
  let ready = !!home?.ready && !!row
  let on = configured && ready && !row?.nofix
  return (
    <Section>
      <Section.Title>
        Automatic fixers
        <Button
          type='button'
          role='switch'
          aria-label='Automatic fixers'
          aria-checked={!!on}
          disabled={!configured || !ready}
          onClick={() => {
            if (!project || !ready) return
            setError(undefined)
            Promise.resolve(io.apply([{
              entity: { eid: project },
              nofix: on ? {} : null,
            }])).catch((error) => setError(String(error)))
          }}
        >
          {home && !home.ready ? 'Loading…' : on ? 'On' : 'Off'}
        </Button>
      </Section.Title>
      <Section.Sub>
        {on
          ? 'Pending tracker bugs can start fixers and follow-up turns on the next check.'
          : 'Automatic fixer starts and follow-up turns are paused. Turning on lets pending tracker bugs start again.'}
        {' '}
        Existing sessions continue. Manual sessions remain available.
      </Section.Sub>
      {!configured && (
        <Section.Sub>No fixer provider is configured.</Section.Sub>
      )}
      {!project && (
        <Section.Note mod='refused'>
          Configure a home project for the automatic fixer switch.
        </Section.Note>
      )}
      {(error || home?.error) && (
        <Section.Note mod='refused'>{error || home?.error}</Section.Note>
      )}
    </Section>
  )
}

/** Configuration is read only; switching writes through the host graph door. */
export let Controls = ({ io }: Props) => {
  let [control, setControl] = useState<Control>()
  let [error, setError] = useState<string>()
  useEffect(() => {
    let abort = new AbortController()
    fetch('/heal/control', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Automatic fixers: ${response.status}`)
        }
        setControl(await response.json())
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error))
      })
    return () => abort.abort()
  }, [])
  return control
    ? <AutoSpawn io={io} control={control} />
    : error
    ? <Section.Note mod='refused'>{error}</Section.Note>
    : <Loading>Loading automatic fixer control…</Loading>
}
