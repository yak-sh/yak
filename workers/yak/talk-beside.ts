// Beside the person's conversation with the Operator (D-153799, The chair):
// in the pane at the page's right (frame.ts `Aside`), under what the
// conversation is doing now, the lists their servers offer that do not wait
// on them (what is working now, spending). What waits on them lives in
// Updates from <Operator> (operator-page.ts `updatesPage`), counted on the
// side's one bell. The lists stand hidden until one has something in it
// (operator-page.ts `lateScript`); on a phone, or beside an app, the pane is
// one press away, from the bar's button.
import { type ComponentChildren as Node, h } from 'preact'

/** The lists, each under its own title, shown once one has something in
 * it. */
export let talkBeside = (lists: Node[], shown: boolean) =>
  h(
    'div',
    { class: 'Talk_Lists', 'aria-label': 'Your lists', hidden: !shown },
    lists,
  )
