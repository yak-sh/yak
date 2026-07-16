import { render } from 'preact'
import { boot } from './live.ts'
import { App } from './components/App.tsx'

// Fill the cache, open the socket, render everything from it.
await boot()
render(<App />, document.body)
