/**
 * @yaks/tmux — a terminal somebody can watch, as an entity.
 *
 * An agent that runs in a pane is not the same thing as the pane. A session is
 * a transcript, a process is a pid, and the terminal is what a person looks at
 * while both are happening — a third fact, which is why it is its own
 * component rather than a property on either. `tmux{of, pane}` records what is
 * running there and where tmux can find it:
 *
 * - **`of`** names whatever the pane is showing — a session, a process,
 *   anything that runs. It is `death: keep`, because a pane outlives what ran
 *   in it: the window is still open, and what it shows next is the next thing
 *   somebody starts there.
 * - **`pane`** is the target string tmux itself accepts — a pane id like `%42`,
 *   or `session:window.pane`. It is stored opaquely on purpose: which form a
 *   caller uses is tmux's business, and a graph that stored a parsed form would
 *   only have to rebuild the string to use it.
 *
 * Most processes have no pane at all, which is the other reason this is a
 * component and not a property: a graph that never touches a terminal never
 * loads this vocabulary. Enabling tmux support is loading it.
 *
 * ## Why the component is `tmux` and the property is `pane` Component names
 * share one flat namespace, and `pane` is already {@link
 * https://jsr.io/@yaks/canvas | @yaks/canvas}'s — a region of a layout, a
 * different idea under the same name. `loadVocab` rejects a component declared
 * twice, and an application may want a canvas and a terminal at once. So the
 * terminal's component is `tmux{…, pane}`: this package's own name carries the
 * component, and `pane` stays the name of the thing tmux actually addresses.
 *
 * ## Declarations only, for now
 * This package declares a vocabulary and nothing else. Sending keys to a pane,
 * finding the pane a session is running in, and attaching to one are things an
 * application does with `tmux` on its path; the one caller that does them today
 * (the fleet's `src/tmux.ts`) drives tmux through a child process, and every
 * check it needs is about its own terminal rather than about a graph. When a
 * second caller needs the same operations they become this package's `./tools`
 * — until then, a declared tool nobody calls would be an interface guessed at
 * rather than one found by use.
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
