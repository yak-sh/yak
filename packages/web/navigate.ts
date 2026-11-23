/**
 * The navigator on a browser's page (@yaks/ui/navigate): loaded by a script
 * marked `data-navigate`, it follows the links of the page's site in place,
 * with the browser's own history.
 *
 * @module
 */
import { start } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

if (typeof document != 'undefined') start(globalThis.window, browserHistory())
