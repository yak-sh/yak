// Sources of persisted Operator channel messages, before entry.from was kept.
import type { Bundle, Comp } from '@yaks/graph'

/** Channel provenance is separate from the member whose permissions apply.
 * Older wakes and voice requests carry the member's actor stamp, although
 * their words were written by the platform or its voice model. */
export let inputSource = (entry: Bundle): string | undefined => {
  let channel = (entry.operator_channel as Comp | undefined)?.channel
  let call = entry.operator_call as Comp | undefined
  if (channel == 'wake' || channel == 'subscription') {
    return `the system (your ${channel == 'wake' ? 'wake-up' : channel})`
  }
  if (channel == 'voice') {
    return call?.asked || call?.said
      ? 'your voice on the call'
      : call?.began
      ? 'the system'
      : 'the person on the phone'
  }
  return undefined
}
