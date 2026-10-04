// Source assets a door serves without importing the app into its host process.
export let entry: URL = new URL('./main.tsx', import.meta.url)
export let styles: URL = new URL('./styles.css', import.meta.url)
