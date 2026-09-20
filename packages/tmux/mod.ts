/**
 * @yaks/tmux — a terminal somebody can watch, as an entity.
 *
 * An agent that runs in a pane is not the same thing as the pane. A session is
 * a transcript, a process is a pid, and the terminal is what a person looks at
 * while both are happening — a third fact, which is why it is its own
 * component rather than a column on either. `tmux{of, pane}` says what is
 * showing and where tmux can find it:
 *
 * - **`of`** names whatever the pane is showing — a session, a process,
 *   anything that runs. It is `death: keep`, because a pane OUTLIVES what ran
 *   in it: the window is still open, and what it shows next is the next thing
 *   somebody starts there.
 * - **`pane`** is the string tmux itself answers to — a pane id like `%42`, or
 *   `session:window.pane`. It is opaque on purpose: which spelling a host uses
 *   is tmux's business, and a graph storing a parsed one would have to
 *   re-spell it to say anything.
 *
 * Most processes have no pane at all, which is the other reason this is a
 * component and not a column: a graph that never touches a terminal never
 * loads these words. Enabling tmux support IS loading them.
 *
 * ## Why the component is `tmux` and the column is `pane`
 * A component name is one flat namespace, and `pane` is already
 * {@link https://jsr.io/@yaks/canvas | @yaks/canvas}'s — a region of a layout,
 * a different idea wearing the same word. `loadVocab` refuses a word declared
 * twice, and a host may want a canvas and a terminal at once. So the terminal
 * says `tmux{…, pane}`: the package's own word carries the component, and
 * `pane` stays the name of the thing tmux actually addresses.
 *
 * ## Words only, for now
 * This package declares a vocabulary and nothing else. Sending keys to a pane,
 * finding the pane a session is in, and attaching one are things a HOST does
 * with `tmux` on its PATH; the one caller that does them today (the fleet's
 * `src/tmux.ts`) drives tmux through a child process, and every guard it needs
 * is about its own terminal rather than about a graph. When a second caller
 * wants the same gestures they become this package's `./tools` — until then a
 * declared tool nobody runs would be a shape guessed rather than found.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { tmuxDoc } from '@yaks/tmux'
 *
 * let vocab = loadVocab([spineDoc, tmuxDoc, mine])
 * ```
 *
 * @module
 */

export { docs, TMUX, tmuxDoc } from './vocab.ts'
