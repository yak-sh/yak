// What the shell understands. `yak …` runs the page's own yak (./yak.js)
// with the line's words, exactly as `yak` reads them on a machine. The rest
// is this page's own small vocabulary, for the machine around the graph: the
// disks, the manual, the tube. Anything else is not found, as in any shell.

import { words } from './term.js'

let pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length))

/**
 * The shell's `exec` and `complete`, over a terminal `term` and the machine
 * `m`: `m.yak()` (yak, once loaded), `m.disks` (id → {n, title, note}),
 * `m.insert(id)`, `m.eject()`, `m.man(topic)`, `m.phosphor(name)`,
 * `m.degauss()`, `m.sound(on)` and `m.status(code)`.
 */
export let sh = (term, m) => {
  let find = (word) => {
    let w = String(word ?? '').toLowerCase().replace(/\.man$/, '')
    return Object.keys(m.disks).find((id) =>
      id == w || String(m.disks[id].n) == w ||
      m.disks[id].title.toLowerCase() == w
    )
  }

  let own = {
    help: {
      about: 'what this shell understands',
      run: () =>
        term.print([
          'yak <words>       the yak command, on a graph in this page',
          '                  (yak help lists what it can do)',
          ...Object.entries(own)
            .filter(([name]) => name != 'help')
            .map(([name, c]) =>
              pad(name + (c.args ? ' ' + c.args : ''), 18) + c.about
            ),
          '',
          'keys: tab completes, ↑ ↓ recall, ctrl-l clears, esc leaves a README',
        ].join('\n')),
    },
    ls: {
      about: 'the disks on the desk',
      run: () =>
        term.print(
          Object.entries(m.disks)
            .map(([id, d]) => `${d.n}  ${pad(id + '.man', 14)}${d.note}`)
            .join('\n'),
        ),
    },
    insert: {
      args: '<disk>',
      about: 'slide a disk into the drive (by name or number)',
      run: ([word]) => {
        let id = find(word)
        if (!id) {
          return term.print(
            `insert: no disk called ${word ?? '…'}; try ls`,
            'note',
          )
        }
        return m.insert(id)
      },
    },
    eject: { about: 'take the disk out', run: () => m.eject() },
    man: {
      args: '<page>',
      about: "a disk's page, or a package's README: man graph",
      run: ([word]) => {
        if (!word) {
          return term.print(
            'man: which page? a disk (ls), or a package: man graph',
            'note',
          )
        }
        let id = find(word)
        return id ? m.insert(id) : m.man(word.replace(/^@yaks\//, ''))
      },
    },
    clear: { about: 'clear the scrollback', run: () => term.clear() },
    history: {
      about: 'the lines typed here',
      run: () =>
        term.print(
          term.history().map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
            .join('\n'),
        ),
    },
    phosphor: {
      args: '[green|amber|white]',
      about: "the tube's color",
      run: ([name]) => m.phosphor(name),
    },
    degauss: { about: "clear the tube's magnetism", run: () => m.degauss() },
    sound: {
      args: '[on|off]',
      about: 'the drive and the tube, audible',
      run: ([state]) => m.sound(state != 'off'),
    },
  }

  let yak = async (argv) => {
    let y = await m.yak()
    let code = await y.run(argv, {
      out: (text) => term.print(text),
      note: (text) => term.print(text, 'note'),
    })
    m.status(code)
  }

  let exec = async (line) => {
    if (!line) return
    let [first, ...rest] = words(line)
    if (first == 'yak') return yak(rest)
    let command = own[first]
    if (command) return command.run(rest)
    await term.print(
      `sh: ${first}: not found. This shell runs yak, and a few words of its own: help`,
      'note',
    )
    m.status(127)
  }

  // Candidates for the word being typed: this shell's words and `yak`, then
  // yak's own nouns and verbs, then the ids of the entities in the graph.
  let complete = async (before) => {
    let from = before.search(/\S*$/)
    let partial = before.slice(from)
    let said = before.slice(0, from).trim().split(/\s+/).filter(Boolean)
    let pool = []
    if (!said.length) pool = ['yak', ...Object.keys(own)]
    else if (said[0] == 'yak') {
      let y = await m.yak()
      let spoken = y.spoken.map((s) => s.split(' '))
      pool = said.length == 1
        ? [...new Set(['help', ...spoken.map((s) => s[0])])]
        : said.length == 2
        ? spoken.filter((s) => s[0] == said[1]).map((s) => s[1])
        : y.everything().map((b) => y.id(b)).filter((id) => !id.startsWith('#'))
    } else if (['insert', 'man'].includes(said[0])) pool = Object.keys(m.disks)
    else if (said[0] == 'phosphor') pool = ['green', 'amber', 'white']
    return { from, words: pool.filter((w) => w?.startsWith(partial)).sort() }
  }

  return { exec, complete }
}
