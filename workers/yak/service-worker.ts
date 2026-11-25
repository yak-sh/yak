// yaks.app's service worker, served as /worker.js: the notifications the
// site pushes (@yaks/push/worker), and its pages and files kept so opening
// one again draws at once (@yaks/web/worker). Signing out (@yaks/platform/
// routes `LOGOUT`), and the sign-in page, forget every kept page: said here
// as the addresses they are, since importing the routes would bring all of
// them into the worker. Browsers that registered it as /push.js are given
// the same worker there.
import '@yaks/push/worker'
import { keeping, type Scope } from '@yaks/web/worker'

keeping(globalThis as unknown as Scope, {
  forget: ['/logout', '/login'],
  named: '/_yak/',
})
