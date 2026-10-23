// The keybinding cards shown by the web and terminal. The handlers stay with
// their platforms, but for vim's walk, which both share (@yaks/ux/keys); this
// is the shared, human-facing vocabulary they teach.
import { walkKeys } from '@yaks/ux/keys'

export type Keybinding = { keys: string[]; about: string; plugin?: string }

export let webKeys: Keybinding[] = [
  { keys: ['?'], about: 'show or close keybindings' },
  ...walkKeys,
  { keys: ['/'], about: 'search the graph' },
  { keys: ['n'], about: 'new entity' },
  { keys: [':'], about: 'open the command line' },
  { keys: ['i'], about: 'enter insert mode' },
  { keys: ['Esc'], about: 'return to normal mode, letting go of the item' },
  { keys: ['Esc', 'q'], about: 'close a peek' },
  { plugin: 'canvas', keys: ['Space'], about: 'frame a canvas card' },
  { plugin: 'canvas', keys: ['0'], about: 'reset canvas zoom' },
]

export let tuiKeys: Keybinding[] = [
  { keys: ['?'], about: 'show or close keybindings' },
  ...walkKeys,
  { keys: ['Ctrl-O', 'Ctrl-F'], about: 'go back or forward' },
  { keys: ['Tab', 'Shift-Tab'], about: 'move to the next or previous control' },
  { keys: ['i'], about: 'edit' },
  { keys: ['Shift-Enter'], about: 'add a reply line while typing' },
  { keys: ['1–4'], about: 'answer a decision with a listed choice' },
  {
    keys: ['a'],
    about: 'write a custom decision answer; Enter sends, Esc keeps it',
  },
  { keys: ['/'], about: 'search the graph' },
  { keys: ['f'], about: 'search' },
  { keys: ['n'], about: 'new entity' },
  {
    keys: ['Esc'],
    about: 'finish editing or return to normal mode, letting go of the item',
  },
  { keys: ['y'], about: 'yank' },
  { keys: [':'], about: 'open the command line' },
  { keys: ['q', 'Ctrl-C'], about: 'quit' },
]
