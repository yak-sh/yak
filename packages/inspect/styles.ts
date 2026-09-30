/**
 * The inspector's stylesheet, exported as `@yaks/inspect/styles`: how its
 * parts stack (./Inspect.css), after @yaks/ui's kit. A host that draws the
 * inspector's views serves these beside its own: its page (./routes.ts), and
 * any other page whose cards carry the Inspect view.
 *
 * @module
 */

/** The CSS files, in the order they are served. */
export let styles: URL[] = [new URL('./Inspect.css', import.meta.url)]
