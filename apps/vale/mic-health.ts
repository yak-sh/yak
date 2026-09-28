import type { MicSignal } from '@yaks/rtc'
export type { MicSignal } from '@yaks/rtc'

/** A local mic warning. A quiet spell is a prompt to test the browser's
 * selected input, not proof that another player cannot hear you. */
export let micHint = (
  mic: 'off' | 'starting' | 'on' | 'denied' | 'missing' | 'spent',
  ready: MediaStreamTrackState | null,
  meter: { talking: boolean } | null,
  signal: MicSignal | null,
  time: { now: number; startedAt: number; lastInput: number },
) => {
  if (mic == 'denied') {
    return 'Mic blocked: allow microphone access in your browser, then retry.'
  }
  if (mic == 'missing' || (mic == 'on' && ready == 'ended')) {
    return 'Mic missing: connect or select an input in your browser, then retry.'
  }
  if (mic != 'on') return null
  if (signal && (!signal.ready || !signal.enabled)) {
    return 'Mic stopped: choose a working browser input, then turn the mic off and on.'
  }
  if (!meter || meter.talking) return null
  if (time.now - Math.max(time.startedAt, time.lastInput) < 8000) return null
  return 'No mic sound detected. Speak to test it; check your browser’s microphone input.'
}

/** Require a newly advancing RTP sender and live media-source voice energy.
 * This is local evidence only: it cannot confirm remote playout. */
export let senderActive = (before: MicSignal | null, now: MicSignal | null) =>
  !!(before && now && now.ready && now.enabled && now.connected &&
    before.packets != null && now.packets != null &&
    now.packets > before.packets &&
    (now.level != null && now.level >= 0.04 ||
      before.energy != null && now.energy != null &&
        before.duration != null && now.duration != null &&
        now.duration > before.duration &&
        (now.energy - before.energy) / (now.duration - before.duration) >=
          0.04 ** 2))
