// The yak at work (T-139963): a short loop of the yaks.app yak for each thing
// the platform can be seen doing, shown at 40 px beside the words that say it,
// in place of a spinner or a pulsing line. The words stay the status a screen
// reader reads, so the picture is decorative (alt=""), and a person who asks
// for less motion sees each loop's first frame.
//
// The files are public/mascot/<pose>.webp (80 px, 2x at the size shown) and
// <pose>-still.webp. A new round of drawings replaces them in place.

/** What the yak can be seen doing. */
export type Pose =
  | 'typing'
  | 'thinking'
  | 'calculating'
  | 'checking'
  | 'searching'

/** The yak doing `pose`, its files under `base` (the apex's address on a page
 * served from another host, '' on the apex). */
export let yak = (pose: Pose, base = '') =>
  `<picture class="Working_Yak" data-pose="${pose}"><source media="(prefers-reduced-motion: reduce)" srcset="${base}/mascot/${pose}-still.webp"><img src="${base}/mascot/${pose}.webp" width="40" height="40" alt=""></picture>`

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
