// A signed-in page of yaks.app, kept by its service worker (/worker.js,
// ./service-worker.ts) so opening it again draws at once (@yaks/web/keep).
import { keep } from '@yaks/web/keep'
import { visibleOperatorOpening } from '@yaks/platform/open-script'

keep(
  globalThis as unknown as Parameters<typeof keep>[0],
  '/worker.js',
  visibleOperatorOpening,
)
