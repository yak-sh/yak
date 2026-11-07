// The page's script: start the page in its root, keeping what the person
// types in this browser's storage until it is sent.
import { start } from './page.ts'

start(document.querySelector('#page')!, { stash: localStorage })
