// What a script's `browser.launch()` runs (code-runtime.ts): puppeteer, made
// once at deploy for a Dynamic Worker, served as `_puppeteer.js` among the
// kernel's assets and read only by a script that browses. Its browser builds
// leave nothing for the Worker to provide but `node:buffer`.
import { build, stop } from 'esbuild'

export let puppeteer = async (): Promise<string> => {
  try {
    let made = await build({
      stdin: {
        contents: "export { default } from '@cloudflare/puppeteer'",
        resolveDir: new URL('./', import.meta.url).pathname,
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      mainFields: ['browser', 'module', 'main'],
      conditions: ['workerd', 'worker', 'browser'],
      minify: true,
      write: false,
      logLevel: 'silent',
    })
    return made.outputFiles[0].text
  } finally {
    await stop()
  }
}
