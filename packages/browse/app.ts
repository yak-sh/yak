// Source assets a door serves without importing the app into its host process.
export let entry: URL = new URL('./main.tsx', import.meta.url)
export let styles: URL = new URL('./styles.css', import.meta.url)

// The ./web facet contributes this app to whichever browser door is configured.
export let app: { entry: URL; styles: URL; mount: URL } = {
  entry,
  styles,
  mount: new URL('./mount.tsx', import.meta.url),
}
