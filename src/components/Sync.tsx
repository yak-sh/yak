// The standing sync indicator (T-21441). An optimistic cache shows every local
// edit as landed the instant it is typed; when the server is unreachable the
// write sits undelivered in the outbox (live.ts) with nothing on screen to say
// so — the exact silence that let the T-21413 data-loss incident run unnoticed
// for 25 minutes. This lives in the App bar and BREAKS that silence: while any
// write is unsent it shows how many wait and how long the oldest has waited, and
// a write the server REFUSED persists as a returnable error the user can read and
// dismiss (M-16612) — durable under its delivery id, surfaced again after the
// reload the drain path triggers, never ephemeral or opaque.
import { useEffect, useState } from 'preact/hooks'
import { clearRefusal, outboxWrites, refused } from '../live.ts'
import { block } from './ui.tsx'

let Frame = block('div', 'Sync', {
  Pending: 'button',
  Refused: 'button',
  Dot: 'span',
  Count: 'span',
  Age: 'span',
  Panel: 'div',
  Item: 'div',
  Head: 'div',
  Reason: 'span',
  When: 'span',
  Summary: 'span',
  Dismiss: 'button',
})
let {
  Pending,
  Refused,
  Dot,
  Count,
  Age,
  Panel,
  Item,
  Head,
  Reason,
  When,
  Summary,
  Dismiss,
} = Frame

// Compact elapsed time — seconds until a minute, then minutes/hours/days. The
// indicator wants sub-minute resolution during an incident, where the shared
// minute tick (ui.tsx) is too coarse to show a write is stuck.
let brief = (since: number, now: number) => {
  let s = Math.max(0, Math.round((now - since) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export let Sync = () => {
  let writes = outboxWrites.value
  let errs = refused.value
  let [open, setOpen] = useState(false)
  let [now, setNow] = useState(Date.now())

  // A one-second tick, armed ONLY while a write is pending (or the refusal panel
  // is open, whose ages also want to move) — self-limiting exactly as the outbox
  // redelivery timer is: nothing waiting, no idle tick.
  useEffect(() => {
    if (!writes.length && !open) return
    let t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [writes.length > 0, open])

  if (!writes.length && !errs.length) return null

  let oldest = writes.reduce((m, w) => Math.min(m, w.since), Infinity)
  let sends = writes.length
  let edits = writes.reduce((n, w) => n + w.count, 0)

  return (
    <Frame>
      {writes.length > 0 && (
        <Pending
          title={`${edits} edit${edits > 1 ? 's' : ''} in ${sends} write${
            sends > 1 ? 's' : ''
          } not yet saved to the server — retrying`}
        >
          <Dot mod='pending' />
          <Count>{sends} unsynced</Count>
          <Age>{brief(oldest, now)}</Age>
        </Pending>
      )}
      {errs.length > 0 && (
        <Refused
          mod={open && 'open'}
          onClick={() => setOpen((v) => !v)}
          title='writes the server refused — click to review'
        >
          <Dot mod='refused' />
          <Count>
            {errs.length} refused
          </Count>
        </Refused>
      )}
      {open && errs.length > 0 && (
        <Panel>
          {errs.map((e) => (
            <Item key={e.id}>
              <Head>
                <Reason>{e.reason}</Reason>
                <When>{brief(e.at, now)} ago</When>
                <Dismiss
                  type='button'
                  aria-label='dismiss'
                  onClick={() => clearRefusal(e.id)}
                >
                  ×
                </Dismiss>
              </Head>
              {e.summary && (
                <Summary>
                  {e.summary} was rolled back — never reached the server.
                </Summary>
              )}
            </Item>
          ))}
        </Panel>
      )}
    </Frame>
  )
}
