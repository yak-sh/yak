// Install browser primitives before the app's module graph evaluates.
import { installHistory } from '@yaks/ui/history'
import { browserHistory } from './history.ts'
// A link off the page's site opens in a new tab.
import './away.ts'
installHistory(browserHistory())
