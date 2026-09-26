// The examples that run. An `.Ex` block marked `data-run=sh` holds yak
// command lines, one to a line; one marked `data-run=js` holds a module,
// which runs as written (its imports resolve through the page's import map)
// with what it prints through console.log shown beside it. On the CRT an
// example types itself into the shell; in reading mode it prints on a panel
// under the block.

import { words } from './term.js'

/** Give every runnable example under `root` its button and, for reading
 * mode, the panel its output prints on. */
export let enhance = (root) => {
  for (let ex of root.querySelectorAll('.Ex[data-run]')) {
    if (ex.querySelector('.Ex_Go')) continue
    let go = document.createElement('button')
    go.type = 'button'
    go.className = 'Ex_Go'
    go.textContent = 'run'
    go.setAttribute('aria-label', 'Run this example here')
    let out = document.createElement('output')
    out.className = 'Ex_Out'
    ex.append(go, out)
  }
}

/** A shell example's command lines. */
export let lines = (ex) =>
  ex.querySelector('code').textContent.split('\n').map((l) => l.trim()).filter(
    Boolean,
  )

/** A module example's source. */
export let source = (ex) => ex.querySelector('code').textContent

let shown = (value) =>
  typeof value == 'string'
    ? value
    : JSON.stringify(value, null, 2) ?? String(value)

/** Run a module's source in this page. `log` is told each line its
 * console.log prints, while it runs. */
export let module = async (code, log) => {
  let url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  let prior = console.log
  console.log = (...args) => {
    log(args.map(shown).join(' '))
    prior(...args)
  }
  try {
    await import(url)
  } finally {
    console.log = prior
    URL.revokeObjectURL(url)
  }
}

/** Run an example in reading mode, printing on its panel with `yak` (the
 * loader) for its shell lines. */
export let read = async (ex, yak) => {
  let out = ex.querySelector('.Ex_Out')
  let say = (text, kind) => {
    let div = document.createElement('div')
    if (kind) div.className = `Out-${kind}`
    div.textContent = text
    out.append(div)
    out.scrollTop = out.scrollHeight
  }
  out.replaceChildren()
  ex.dataset.running = ''
  try {
    if (ex.dataset.run == 'js') {
      say('» the example, running in this page', 'cmd')
      await module(source(ex), (line) => say(line))
      return
    }
    let loading = setTimeout(() => say('loading yak from JSR…'), 150)
    let y = await yak()
    clearTimeout(loading)
    out.replaceChildren()
    for (let line of lines(ex)) {
      say(`$ ${line}`, 'cmd')
      let [first, ...rest] = words(line)
      if (first != 'yak') {
        say(`only yak runs here: ${first}`, 'note')
        continue
      }
      await y.run(rest, { out: (t) => say(t), note: (t) => say(t, 'note') })
    }
  } catch (error) {
    say(String(error?.message ?? error), 'note')
  } finally {
    delete ex.dataset.running
  }
}
