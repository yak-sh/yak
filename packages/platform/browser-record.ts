// A visit's steps as a recording: Chrome's screencast (CDP
// `Page.startScreencast`) of the page from the moment its steps begin to the
// moment they end. Chrome sends a frame only when the page changes, so each
// frame is named for when it was shown, in ms from the first:
// `rec-000000.jpg`, `rec-000412.jpg`. A frame lasts until the next one, and
// the last until the recording's `ms`.

import type { Session } from './browser-visit.ts'

/** A recorded frame: its name and its JPEG, base64. */
export type Frame = { name: string; image: string }

/** A recording: its frames in order, and how long it ran from the first. */
export type Recorded = { frames: Frame[]; ms: number }

/** The name a frame shown `ms` after the first is kept under. */
export let frameName = (ms: number) =>
  `rec-${String(Math.max(0, Math.round(ms))).padStart(6, '0')}.jpg`

/** When a frame named by {@link frameName} was shown, in ms, or null for a
 * name that is no frame's. */
export let frameAt = (name: string): number | null => {
  let m = /^rec-(\d+)\.jpg$/.exec(name.replace(/^.*\//, ''))
  return m ? Number(m[1]) : null
}

// A screencast frame as Chrome sends it: `timestamp` in seconds.
type Said = {
  data: string
  sessionId: number
  metadata: { timestamp?: number }
}

/** Start recording the page `cdp` belongs to, at most `width` × `height`;
 * the answer stops it and gives the recording. Frames are spaced by
 * Chrome's own clock; the end is the last frame plus the time since it
 * arrived, on ours. */
export let recording = async (
  cdp: Session,
  { width, height }: { width: number; height: number },
  now: () => number = Date.now,
): Promise<() => Promise<Recorded>> => {
  let first: number | null = null
  let last = { at: 0, heard: now() }
  let frames: Frame[] = []
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }: Said) => {
    let heard = now()
    let shown = metadata.timestamp != null ? metadata.timestamp * 1000 : heard
    first ??= shown
    last = { at: Math.max(last.at, shown - first), heard }
    frames.push({ name: frameName(last.at), image: data })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 85,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1,
  })
  return async () => {
    let ms = Math.round(last.at + now() - last.heard)
    await cdp.send('Page.stopScreencast')
    return { frames, ms }
  }
}
