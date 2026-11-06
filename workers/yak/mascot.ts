// The yak at work (T-139963): a short loop of the yaks.app yak for each thing
// the platform can be seen doing, shown at 40 px beside the words that say it,
// in place of a spinner or a pulsing line. The words stay the status a screen
// reader reads, so the picture is decorative (alt=""), and a person who asks
// for less motion sees each loop's first frame.
//
// The files are public/mascot/<pose>.webp and <pose>-still.webp, each at 40,
// 80 and 120 px (`-1x`, none, `-3x`), so a screen of any density gets one it
// shows pixel for pixel. A new round of drawings replaces them in place.
//
// While the Operator waits for the person, the yak sits on the new chat's
// greeting at 128 px and now and then does something small (T-141047): his
// rest frame is public/mascot/idle-rest-128.webp and each loop
// idle-<loop>-128.webp, at 128, 256 and 384 px. public/idle.js plays them.

import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Loading } from '@yaks/ui'

/** What the yak can be seen doing. */
export type Pose =
  | 'typing'
  | 'thinking'
  | 'calculating'
  | 'checking'
  | 'searching'

/** The srcset of one of the yak's files, `name` under `base`. */
let srcset = (name: string, base: string) =>
  [['-1x', '1x'], ['', '2x'], ['-3x', '3x']]
    .map(([file, density]) => `${base}/mascot/${name}${file}.webp ${density}`)
    .join(', ')

/** The yak doing `pose`, the kit's mark of something at work (@yaks/ui
 * `Loading.Mark`), its files under `base` (the apex's address on a page
 * served from another host, '' on the apex). */
export let Yak = ({ pose, base = '' }: { pose: Pose; base?: string }) =>
  h(
    Loading.Mark,
    { 'data-pose': pose },
    h(
      'picture',
      null,
      h('source', {
        media: '(prefers-reduced-motion: reduce)',
        srcset: srcset(`${pose}-still`, base),
      }),
      h('img', {
        src: `${base}/mascot/${pose}.webp`,
        srcset: srcset(pose, base),
        width: 40,
        height: 40,
        alt: '',
      }),
    ),
  )

/** The yak doing `pose`, as markup. */
export let yak = (pose: Pose, base = '') =>
  renderToString(h(Yak, { pose, base }))

/** What the yak does now and then while he waits, each loop this many ms,
 * starting and ending on his rest frame so one follows another seamlessly. */
export let IDLE: Record<string, number> = {
  glance: 3370,
  ears: 2070,
  tail: 2380,
  stretch: 2250,
  lick: 2070,
  doze: 3550,
}

/** The yak waiting, 128 px across, with `className`: at rest, and with
 * public/idle.js every several seconds one of his loops (`IDLE`). */
export let Idle = ({ class: className, base = '' }: {
  class: string
  base?: string
}) =>
  h('img', {
    class: className,
    src: `${base}/mascot/idle-rest-128.webp`,
    srcset: srcset('idle-rest-128', base),
    width: 128,
    height: 128,
    alt: '',
    'data-idle': Object.entries(IDLE).map(([loop, ms]) => `${loop}:${ms}`)
      .join(' '),
  })

/** The yak waiting, as markup. */
export let idle = (className: string, base = '') =>
  renderToString(h(Idle, { class: className, base }))

// What a step's first word shows the yak doing (@yaks/tools `stepOf`: "Checking
// cookbook for errors…"). Any other work is the yak at its keyboard.
let VERBS: Record<string, Pose> = {
  Thinking: 'thinking',
  Checking: 'checking',
  Reading: 'searching',
  Listing: 'searching',
  Looking: 'searching',
  Searching: 'searching',
  Finding: 'searching',
  Calculating: 'calculating',
  Pricing: 'calculating',
}

/** The pose that matches a step's words while it runs; typing when nothing
 * is said. */
export let poseOf = (doing: string): Pose =>
  VERBS[doing.split(' ')[0].replace(/…$/, '')] ?? 'typing'
