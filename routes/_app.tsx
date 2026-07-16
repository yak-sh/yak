import { define } from '../utils.ts'

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
        <title>Tasks</title>
        <link
          rel='icon'
          type='image/png'
          sizes='192x192'
          href='/icon-192.png'
        />
        <link
          rel='icon'
          type='image/png'
          sizes='512x512'
          href='/icon-512.png'
        />
        <link rel='apple-touch-icon' href='/apple-touch-icon.png' />
        <link rel='stylesheet' href='/styles.css' />
      </head>
      <body>
        <Component />
      </body>
    </html>
  )
})
