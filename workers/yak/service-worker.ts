// yaks.app's service worker, served as /worker.js: the notifications the
// site pushes (@yaks/push/worker), and its pages and files kept so opening
// one again draws at once (@yaks/web/worker), the page a notification opens
// kept as the push arrives, and the frame's shell drawn at once for every
// other page in it (@yaks/platform/routes `framed`). Signing out (`LOGOUT`),
// and the sign-in page, forget every kept page and each person's page graph
// (@yaks/platform/page-graph `pageDatabase`, said here as the name it is,
// since importing it would bring all it imports into the worker). Browsers
// that registered it as /push.js are given the same worker there.
import '@yaks/push/worker'
import { opens } from '@yaks/push/notice'
import { keeping, type Scope } from '@yaks/web/worker'
import { OPEN_PATH } from '@yaks/timing/interaction'
import { openScript, plainAddress } from '@yaks/platform/open-script'
import { framed, LOGOUT } from '@yaks/platform/routes'

keeping(globalThis as unknown as Scope, {
  forget: [LOGOUT, '/login'],
  named: '/_yak/',
  databases: 'yaks-page:',
  opens,
  address: plainAddress,
  shelled: (url) => framed(new URL(url).pathname),
  opening: (source) => openScript(OPEN_PATH, source),
  report: OPEN_PATH,
})
