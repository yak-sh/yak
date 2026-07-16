import { type Ent } from '../../types.ts'
import { config } from '../../live.ts'
import { block, el } from '../ui.tsx'

let Frame = el('iframe', 'Web')
let Wait = block('div', 'WebWait', { Url: 'span', Go: 'button' })
let { Url, Go } = Wait

// A web entity renders its FROZEN archive — the server's one-file,
// script-free snapshot of the page — never the live site (which can rot,
// track, or refuse framing). Until the freeze lands, a waiting state with
// a retry button (also the thumb for pre-freeze entities and failures).
export let Web = ({ e }: { e: Ent }) =>
  e.web!.frozen_at
    ? <Frame sandbox='allow-same-origin' src={`/frozen/${e.eid}.html`} />
    : (
      <Wait>
        <Url>freezing {e.web!.url} …</Url>
        <Go
          type='button'
          onClick={() =>
            fetch(`http://${config.host}/freeze?eid=${e.eid}`).catch(() => {})}
        >
          ↻ retry
        </Go>
      </Wait>
    )
