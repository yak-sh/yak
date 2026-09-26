// The shell pane: its scrollback, the line being typed, and the keys a
// person types into it. What a line means is not this module's: each one
// entered is handed to `exec` (sh.js), which prints its answer back through
// `print`. The line itself lives in a hidden <input>, so typing, pasting, a
// phone's keyboard and an IME all work as they do anywhere; what shows is the
// phosphor copy of it, with a block cursor over the character at the caret.

import { key } from './sound.js'

let wait = (ms) => new Promise((r) => setTimeout(r, ms))
let frame = () => new Promise((r) => requestAnimationFrame(r))

// The longest prefix every candidate shares.
let common = (words) =>
  words.reduce((a, b) => {
    let i = 0
    while (i < a.length && a[i] == b[i]) i++
    return a.slice(0, i)
  })

/**
 * A terminal over the shell pane's elements. It asks `said` what a line
 * means as each one is entered, so the words can be handed over once the
 * machine they reach is built: `said.exec(line)` runs a line and resolves
 * when its answer is printed, and `said.complete(before)` answers the
 * candidates for the word being typed and where it starts.
 */
export let terminal = (els, said) => {
  let { shell, log, typed, cursor, after, input } = els
  let history = []
  let back = 0
  let busy = false
  let queue = Promise.resolve()

  let text = () => input.value
  let caret = () => input.selectionStart ?? text().length

  let paint = () => {
    let t = text()
    let at = caret()
    typed.textContent = t.slice(0, at)
    cursor.textContent = t[at] ?? ' '
    after.textContent = t.slice(at + 1)
  }

  let set = (value, at = value.length) => {
    input.value = value
    input.setSelectionRange(at, at)
    paint()
  }

  let bottom = () => shell.scrollTop = shell.scrollHeight

  // Lines are painted a few per frame, the way a terminal at speed scrolls,
  // and each glows as it lands.
  let pending = []
  let draining
  let drain = async () => {
    while (pending.length) {
      let batch = pending.splice(0, Math.max(3, pending.length >> 3))
      log.append(...batch)
      bottom()
      await frame()
    }
    draining = null
  }

  let line = (content, kind) => {
    let div = document.createElement('div')
    div.className = kind ? `Fresh Out-${kind}` : 'Fresh'
    if (typeof content == 'string') div.textContent = content
    else div.append(content)
    return div
  }

  /** Print text (every line of it), or a node, in the scrollback. `kind` is
   * `cmd`, `note` (stderr), `dim` or `sys`. Resolves once it is painted. */
  let print = (content, kind) => {
    let lines = typeof content == 'string' ? content.split('\n') : [content]
    pending.push(...lines.map((l) => line(l, kind)))
    return draining ??= drain()
  }

  /** A line that says what the machine is doing, and can be rewritten in
   * place: `set(text)` changes it. */
  let status = (text) => {
    let div = line(text, 'sys')
    log.append(div)
    bottom()
    return { set: (t) => (div.textContent = t, bottom()) }
  }

  let clear = () => {
    pending = []
    log.replaceChildren()
  }

  let enter = async (entered) => {
    await print(`yak.sh $ ${entered}`, 'cmd')
    if (entered.trim()) {
      if (history.at(-1) != entered) history.push(entered)
    }
    back = 0
    busy = true
    shell.dataset.busy = ''
    try {
      await said.exec(entered.trim())
    } catch (error) {
      await print(String(error?.message ?? error), 'note')
    } finally {
      busy = false
      delete shell.dataset.busy
      bottom()
    }
  }

  let submit = () => {
    let entered = text()
    set('')
    queue = queue.then(() => enter(entered))
    return queue
  }

  // Tab: finish the word being typed, or list what it could be.
  let tab = async () => {
    let before = text().slice(0, caret())
    let { from, words } = await said.complete(before)
    if (!words.length) return
    let word = words.length == 1 ? words[0] + ' ' : common(words)
    let rest = text().slice(caret())
    set(before.slice(0, from) + word + rest, from + word.length)
    if (words.length > 1 && word.length <= before.length - from) {
      await print(`yak.sh $ ${text()}`, 'dim')
      await print(words.join('   '), 'dim')
    }
  }

  let recall = (step) => {
    back = Math.max(0, Math.min(history.length, back + step))
    set(back ? history[history.length - back] : '')
  }

  let chord = (e) => {
    let t = text()
    let at = caret()
    let keys = {
      a: () => set(t, 0),
      e: () => set(t),
      u: () => set(t.slice(at), 0),
      k: () => set(t.slice(0, at), at),
      w: () => {
        let from = t.slice(0, at).replace(/\S+\s*$/, '').length
        set(t.slice(0, from) + t.slice(at), from)
      },
      l: () => clear(),
      c: () => (print(`yak.sh $ ${t}^C`, 'dim'), set('')),
    }
    let act = keys[e.key]
    if (!act) return false
    e.preventDefault()
    act()
    return true
  }

  input.addEventListener('input', paint)
  input.addEventListener('select', paint)
  document.addEventListener('selectionchange', () => {
    if (document.activeElement == input) paint()
  })
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.altKey && !e.metaKey && chord(e)) return
    let keys = {
      Enter: () => submit(),
      Tab: () => tab(),
      ArrowUp: () => recall(1),
      ArrowDown: () => recall(-1),
    }
    let act = keys[e.key]
    if (!act) return
    e.preventDefault()
    act()
  })
  // A key arrives before the caret moves, so the line is painted after it.
  input.addEventListener('keyup', paint)

  /** Type a line out, a key at a time, and enter it: what an example does.
   * Queued behind whatever is already running. */
  let type = (entered) =>
    queue = queue.then(async () => {
      set('')
      let pace = Math.min(55, 1400 / Math.max(entered.length, 1))
      for (let ch of entered) {
        set(text() + ch)
        key()
        await wait(pace * (.55 + Math.random() * .9) + (ch == ' ' ? pace : 0))
      }
      await wait(180)
      set('')
      await enter(entered)
    })

  /** Run something that prints but was not typed (a disk loading), queued
   * like a line. */
  let run = (task) => queue = queue.then(task)

  let focus = () => input.focus({ preventScroll: true })

  paint()
  return {
    print,
    status,
    clear,
    type,
    run,
    focus,
    history: () => [...history],
    busy: () => busy,
  }
}

/** A line's words, split the way a POSIX shell splits them: on white space,
 * except inside single quotes (taken as written) or double quotes (where a
 * backslash escapes the next character). An unclosed quote is refused. */
export let words = (line) => {
  let out = []
  let word = null
  let quote = null
  for (let i = 0; i < line.length; i++) {
    let c = line[i]
    if (quote == "'") {
      if (c == "'") quote = null
      else word += c
    } else if (quote == '"') {
      if (c == '"') quote = null
      else word += c == '\\' && i + 1 < line.length ? line[++i] : c
    } else if (/\s/.test(c)) {
      if (word != null) out.push(word)
      word = null
    } else {
      word ??= ''
      if (c == "'" || c == '"') quote = c
      else word += c == '\\' && i + 1 < line.length ? line[++i] : c
    }
  }
  if (quote) throw new Error(`sh: unmatched ${quote}`)
  if (word != null) out.push(word)
  return out
}
