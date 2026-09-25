// The shared visible face of an addressed subscription refusal. The server
// supplies the durable reason/reference; this component keeps retry on the same
// stable subscription identity so success replaces the failure normally.
import { useState } from 'preact/hooks'
import { retrySubscription, type SubscriptionRead } from '../live.ts'
import { block } from './ui.tsx'

let Frame = block('p', 'SubscriptionFailure', { Retry: 'button' })
let { Retry } = Frame

export let SubscriptionFailure = ({ read }: { read: SubscriptionRead }) => {
  let [retried, setRetried] = useState(false)
  if (read.state.status != 'failed') return null
  return (
    <Frame>
      Query could not be loaded: {read.state.reason} [{read.state.reference}]
      {' '}
      <Retry
        type='button'
        onClick={() => {
          setRetried(true)
          if (!retrySubscription(read.sub)) setRetried(false)
        }}
      >
        {retried ? 'retry again' : 'retry'}
      </Retry>
      {retried && ' Retry requested.'}
    </Frame>
  )
}
