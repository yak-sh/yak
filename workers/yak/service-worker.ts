// yaks.app's service worker, served as /worker.js: the notifications the
// site pushes (@yaks/push/worker), and its pages and files kept so opening
// one again draws at once (@yaks/web/worker), and the page a notification
// opens kept as the push arrives. Signing out (@yaks/platform/
// routes `LOGOUT`), and the sign-in page, forget every kept page and each
// person's page graph (@yaks/platform/page-graph `pageDatabase`): said here
// as the names they are, since importing either module would bring all it
// imports into the worker. Browsers that registered it as /push.js are given
// the same worker there.
import '@yaks/push/worker'
import { opens } from '@yaks/push/notice'
import { keeping, type Scope } from '@yaks/web/worker'

keeping(globalThis as unknown as Scope, {
  forget: ['/logout', '/login'],
  named: '/_yak/',
  databases: 'yaks-page:',
  opens,
})
