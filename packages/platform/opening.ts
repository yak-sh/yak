// yaks.app's look while one of its pages opens, and when opening fails
// (@yaks/web/opening): its linen background and warm-brown ink, cocoa in the
// dark, and its mark. Said here, apart from what a page wears (woven.ts), so
// the service worker that draws a failed open carries nothing else. It is
// @yaks/web/opening's `Opening` by shape: the platform never imports @yaks/web,
// which depends on it.

// The platform's own page background and ink in its two linen schemes.
export let PLATFORM_BACKGROUND = '#fdf7ee'
export let PLATFORM_DARK_BACKGROUND = '#2b231f'
let INK = '#523828'
let DARK_INK = '#f1e6d8'

/** Where the opening screen draws its mark, in CSS pixels: its size and
 * corner (@yaks/web/opening's `.YakOpening img`), and how far above the
 * middle it sits, which is half of the gap and the bar below it. An app's
 * splash (./splash.ts) draws its icon here, so the two meet without a jump. */
export let MARK = { size: 88, radius: 20, lift: 10 }

/** yaks.app's opening, its mark at `mark` and its report door at `report`. */
export let opening = (mark: string, report: string) => ({
  name: 'yaks.app',
  background: PLATFORM_BACKGROUND,
  ink: INK,
  dark: { background: PLATFORM_DARK_BACKGROUND, ink: DARK_INK },
  mark,
  report,
})
