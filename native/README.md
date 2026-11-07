# The yaks.app iOS shell

An Expo app (SDK 58, React Native 0.88): sign in once, then the space's
Operator, its apps and its pages. A kit-built app is drawn natively: its view
renders through Preact into @yaks/tui's in-memory DOM, @yaks/native paints the
tree as plain nodes, and `kit.tsx` turns those into React Native views. Every
other app, the Operator and the space's pages open as their web pages in a web
view holding the same session (D-148409).

- `App.tsx`: sign-in, the three tabs, and what each opens.
- `yaks.ts`: the doors it asks yaks.app at, the ones a browser uses: the sign-in
  card's posts, the connector's tools at `/mcp`, and an app's store at
  `<app>/api/`.
- `kit.tsx`: the React Native host for @yaks/native's nodes, and `drawn`, the
  apps it draws natively by slug. Their view modules are bundled with the shell
  for now (apps/packing/view.ts).
- `globals.ts`: the `Event` and window @yaks/tui's DOM reaches for, which Hermes
  lacks.
- `metro.config.js`: resolves `@yaks/ui` to its parts, the in-memory DOM and the
  painter from `packages/`, and the shell's own React, React Native and Preact
  for every file.

## Run it on a phone with Expo Go

Expo Go needs no Apple account. From this directory:

```sh
npm install
cloudflared tunnel --url http://localhost:8081      # prints https://<name>.trycloudflare.com
EXPO_PACKAGER_PROXY_URL=https://<name>.trycloudflare.com npx expo start --port 8081 --go
```

Open `exp://<name>.trycloudflare.com` on the iPhone, from the camera or Safari,
with Expo Go installed. `npx expo export --platform ios` checks that the bundle
compiles.
