import { type Ent } from '../../types.ts'
import { base } from '../../live.ts'
import { block, el } from '../ui.tsx'

let Frame = el('iframe', 'Web')
let Wait = block('div', 'WebWait', {
  Url: 'span',
  Error: 'span',
  Go: 'button',
})
let { Url, Error, Go } = Wait

// A web entity renders its FROZEN archive, never the live site (which
// can rot, track, or refuse framing). Provenance picks the sandbox: a
// URL freeze is a stranger's page — no scripts; a delivered page is an
// agent's own artifact — scripts run, but in an opaque origin (no
// allow-same-origin), walled off from the app. Until the freeze lands,
// a waiting state with a retry button (also the thumb for pre-freeze
// entities and failures).
export let Web = ({ e }: { e: Ent }) =>
  e.web!.frozen_at
    ? (
      <Frame
        sandbox={e.web!.url ? 'allow-same-origin' : 'allow-scripts'}
        src={`/frozen/${e.eid}.html`}
      />
    )
    : (
      <Wait>
        {e.error?.message
          ? <Error>{e.error.message}</Error>
          : <Url>freezing {e.web!.url} …</Url>}
        <Go
          type='button'
          onClick={() => fetch(`${base()}/freeze?eid=${e.eid}`).catch(() => {})}
        >
          ↻ retry
        </Go>
      </Wait>
    )
