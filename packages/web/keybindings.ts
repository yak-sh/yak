// The keybinding cards shown by the web and terminal. The handlers stay with
// their platforms; this is the shared, human-facing vocabulary they teach.

export type Keybinding = { keys: string[]; about: string; plugin?: string }

export let webKeys: Keybinding[] = [
  { keys: ['?'], about: 'show or close keybindings' },
  { keys: ['/'], about: 'search the graph' },
  { keys: ['n'], about: 'open or close navigation' },
  { keys: [':'], about: 'open the command line' },
  { keys: ['i'], about: 'enter insert mode' },
  { keys: ['Esc'], about: 'return to normal mode' },
  { plugin: 'canvas', keys: ['Space'], about: 'frame a canvas card' },
  { plugin: 'canvas', keys: ['0'], about: 'reset canvas zoom' },
  { keys: ['q'], about: 'close a preview' },
]

export let tuiKeys: Keybinding[] = [
  { keys: ['?'], about: 'show or close keybindings' },
  { keys: ['n'], about: 'open or close navigation' },
  { keys: ['j', 'k'], about: 'browse' },
  { keys: ['l'], about: 'follow an entity link' },
  { keys: ['Enter'], about: 'open a thread, use a button or type in a field' },
  { keys: ['h', 'Ctrl-D'], about: 'go back' },
  { keys: ['Tab', 'Shift-Tab'], about: 'change view' },
  { keys: ['i'], about: 'edit' },
  { keys: ['Shift-Enter'], about: 'add a reply line while typing' },
  { keys: ['1–4'], about: 'answer a decision with a listed choice' },
  {
    keys: ['a'],
    about: 'write a custom decision answer; Enter sends, Esc keeps it',
  },
  { keys: ['/'], about: 'search the graph' },
  { keys: ['f'], about: 'filter the board' },
  { keys: ['Esc'], about: 'finish editing or return to normal mode' },
  { keys: ['y'], about: 'yank' },
  { keys: [':'], about: 'open the command line' },
  { keys: ['q', 'Ctrl-C'], about: 'quit' },
]
