# The yaks iOS shell

An Expo app (SDK 58, React Native 0.88): sign in once, then the space's
Operator, its apps and its pages. yaks.app is one variant of it; a township's or
an org's app is another, built from the same code (`variants.ts`). A kit-built
app is drawn natively: its view renders through Preact into @yaks/tui's
in-memory DOM, @yaks/native paints the tree as plain nodes, and `kit.tsx` turns
those into React Native views. Every other app, the Operator and the space's
pages open as their web pages in a web view holding the same session (D-148409).

- `variants.ts`: each app the shell is built as, as data: its name, bundle id,
  icon, Apple team, EAS Update channel, the space it opens, and which config
  plugins and apps it carries. `app.config.ts` makes `app.json` into the one
  `YAKS_VARIANT` names (yaks.app where it names none), and `eas.json` has a
  build profile for each.
- `App.tsx`: sign-in, the three tabs, and what each opens, under the space's
  brand: its name, its Operator's name and its logo, from the space's web
  manifest (`yaks.ts` `brandOf`).
- `yaks.ts`: the doors it asks yaks.app at, the ones a browser uses: the sign-in
  card's posts and the connector's tools at `/mcp`.
- `remote.ts`: the packages the shell carries (`preact`, `preact/hooks`,
  `@yaks/ui`) for a kit-built app's view, which `@yaks/native/remote` loads from
  the app itself, so a deploy reaches the phone without a new shell. An app that
  names no view, or imports a package the shell does not carry, opens as its web
  page. `yak open` loads the same view the same way in a terminal.
- `kit.tsx`: the React Native host for @yaks/native's nodes.
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

## Publish it

The shell is the EAS project @justyaks/yaks-app. Expo Go opens its channel
`main` at
`exp://u.expo.dev/f87fef9c-5d1c-4fef-9f9c-f62d4872c6d6?channel-name=main&runtime-version=exposdk:58.0.0`,
with no dev server running. Publish a new shell to it with:

```sh
npx eas-cli update --channel main --platform ios --environment preview --message '<what changed>'
```

Every variant has its own channel in the same project. The checks variant, a
test org over the checks space, is channel `checks`:

```sh
YAKS_VARIANT=checks npx eas-cli update --channel checks --platform ios --environment preview --message '<what changed>'
```

Expo Go opens it at
`exp://u.expo.dev/f87fef9c-5d1c-4fef-9f9c-f62d4872c6d6?channel-name=checks&runtime-version=exposdk:58.0.0`.

## A new variant

Add an entry to `VARIANTS` in `variants.ts` (a name, a bundle id, a channel, and
the space it opens), a build profile of the same name in `eas.json` setting
`YAKS_VARIANT`, and publish to its channel as above. An icon is a 1024-pixel PNG
beside `app.config.ts`; the Apple team is its team id. The space gives the rest:
set its title, its Operator's name and its logo on yaks.app.

A kit-built app's view needs no publish: the shell loads it from the deployed
app (`@yaks/native/remote`).
