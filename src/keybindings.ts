// The keybinding cards shown by the web and terminal. The handlers stay with
// their platforms; this is the shared, human-facing vocabulary they teach.

export type Keybinding = { keys: string[]; about: string }

export let webKeys: Keybinding[] = [
  { keys: ['?'], about: 'show or close keybindings' },
  { keys: ['/'], about: 'search the graph' },
  { keys: [':'], about: 'open the command line' },
  { keys: ['t'], about: 'open or close the tray' },
  { keys: ['i'], about: 'enter insert mode' },
  { keys: ['Esc'], about: 'return to normal mode' },
  { keys: ['Space'], about: 'frame a canvas card' },
  { keys: ['0'], about: 'reset canvas zoom' },
  { keys: ['q'], about: 'close a preview' },
]

export let tuiKeys: Keybinding[] = [
  { keys: ['?'], about: 'show or close keybindings' },
  { keys: ['j', 'k'], about: 'browse' },
  { keys: ['l', 'Enter'], about: 'enter' },
  { keys: ['h', 'Ctrl-D'], about: 'go back' },
  { keys: ['Tab', 'Shift-Tab'], about: 'change view' },
  { keys: ['i'], about: 'edit' },
  { keys: ['Esc'], about: 'finish editing or return to normal mode' },
  { keys: ['y'], about: 'yank' },
  { keys: [':'], about: 'open the command line' },
  { keys: ['q', 'Ctrl-C'], about: 'quit' },
]
