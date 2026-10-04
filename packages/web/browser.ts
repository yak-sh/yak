// Install browser primitives before the app's module graph evaluates.
import { installHistory } from '@yaks/ui/history'
import { browserHistory } from './history.ts'
installHistory(browserHistory())
