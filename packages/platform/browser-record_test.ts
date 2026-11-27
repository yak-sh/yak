import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { frameAt, frameName, recording } from './browser-record.ts'

// A CDP session that answers every command, and sends the frames a test
// shows it, each [base64, Chrome's timestamp in s].
let session = () => {
  let sent: [string, unknown][] = []
  let hear: (said: unknown) => void = () => {}
  return {
    sent,
    show: (data: string, timestamp: number, id: number) =>
      hear({ data, sessionId: id, metadata: { timestamp } }),
    cdp: {
      send: (method: string, params?: unknown) => {
        sent.push([method, params])
        return Promise.resolve({})
      },
      on: (_: string, h: (said: unknown) => void) => {
        hear = h
      },
    },
  }
}

test('a recording names each frame for when it was shown, and runs to its stop', async () => {
  let clock = 1000
  let s = session()
  let stop = await recording(s.cdp, { width: 1280, height: 720 }, () => clock)
  assertEquals(s.sent[0], ['Page.startScreencast', {
    format: 'jpeg',
    quality: 85,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1,
  }])
  clock = 1100
  s.show('AAAA', 50.0, 1)
  clock = 1600
  s.show('BBBB', 50.4125, 2)
  clock = 3600
  let { frames, ms } = await stop()
  assertEquals(frames, [
    { name: 'rec-000000.jpg', image: 'AAAA' },
    { name: 'rec-000413.jpg', image: 'BBBB' },
  ])
  // The last frame came 413 ms in and 2 s before the stop.
  assertEquals(ms, 2413)
  assertEquals(s.sent.map(([m]) => m), [
    'Page.startScreencast',
    'Page.screencastFrameAck',
    'Page.screencastFrameAck',
    'Page.stopScreencast',
  ])
})

test('a frame’s name says when it was shown', () => {
  assertEquals(frameName(1234.4), 'rec-001234.jpg')
  assertEquals(frameAt('/tmp/x/rec-001234.jpg'), 1234)
  assertEquals(frameAt('end.png'), null)
})
