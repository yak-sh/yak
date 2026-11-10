// The studio page's script: the desk, started in this page with the browser's
// own. recovery.js is served beside the page and reaches the platform's draft
// desk from there, so its address is resolved as the page runs.
import { start } from './desk.ts'

let { recovery } = await import(
  new URL('./recovery.js', document.baseURI).href
)

await start(document.querySelector('#desk')!, {
  fetch: (url, init) => fetch(url, init),
  location,
  history,
  window,
  recovery,
})
