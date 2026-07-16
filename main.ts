import { App, staticFiles } from 'fresh'
import { type State } from './utils.ts'
import './sync.ts' // side effect: the websocket sync listener

export const app = new App<State>()

app.use(staticFiles())
app.fsRoutes()
