/**
 * The cli facet, exported as `@yaks/ui/cli`: `yak ui`, the style guide held
 * in this terminal (./tui.ts), the same page `/ui` answers a browser. It
 * reads nothing from a graph.
 *
 * @module
 */

/** A command, in the shape @yaks/cli's `CliCommand` reads. @yaks/cli dresses
 * its answers in this package, so this one says the shape rather than
 * importing it. */
export type Command = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: () => Promise<number>
}

/** `yak ui`: every part in every variant, in every theme. */
export let commands: Command[] = [{
  name: 'ui',
  description: "Open @yaks/ui's style guide in this terminal: every part " +
    'in every variant, as /ui shows it in a browser, in each theme.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  // What it runs is imported when it runs: every command line lists this one.
  run: async () => {
    let { open } = await import('./tui.ts')
    await open()
    return 0
  },
}]
