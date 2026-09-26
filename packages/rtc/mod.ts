/**
 * @yaks/rtc — voice between pages over Cloudflare Realtime.
 *
 * A page {@link join}s a call through its app's Realtime door, publishes a
 * microphone, and hears the tracks it asks for. What it says is named on the
 * entity it speaks as, in the relayed `rtc` component, so a listener finds a
 * voice where it finds everything else about that entity:
 *
 * ```ts ignore
 * import { join, microphone } from '@yaks/rtc'
 *
 * let call = await join({ entity: hero, write: (b) => client.mutate(b) })
 * await call.publish(await microphone())
 * // a peer wearing rtc{session, tracks: ['voice']}:
 * let voice = await call.hear(peer.rtc.session, 'voice')
 * audio.createMediaStreamSource(voice!.stream).connect(panner)
 * ```
 *
 * The host half, which keeps the account's secret, the sessions and the
 * meter, is `@yaks/rtc/door`; the components are `@yaks/rtc/vocab`.
 *
 * @module
 */

export {
  BITRATE,
  type Call,
  type Heard,
  join,
  microphone,
  type Opts,
  type Published,
  Refused,
  RENEW,
  type State,
  voiced,
} from './join.ts'
export { docs, rtcDoc } from './vocab.ts'
