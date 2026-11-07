// The shell's variants: each is one app on a home screen, built from the same
// code and told apart only by this data (D-148409). A variant names what the
// app is called, its bundle id and icon, the Apple team it ships under, the
// EAS Update channel it listens on, the space it opens, and which config
// plugins and apps it carries. Its brand past its name, and its Operator, are
// its space's own (yaks.ts `brandOf`). app.config.ts picks one by
// `YAKS_VARIANT`; eas.json has a build profile for each.

/** One white-labelled app. */
export type Variant = {
  /** What the home screen calls it. */
  name: string
  /** Its iOS bundle identifier. */
  bundle: string
  /** The EAS Update channel it loads updates from. */
  channel: string
  /** The one space it opens; none for every space the person is in. */
  space?: string
  /** The apps of that space it lists, by slug; none for all of them. */
  apps?: string[]
  /** Its home-screen icon, a 1024-pixel PNG, relative to this directory. */
  icon?: string
  /** The Apple team it is signed and shipped under. */
  team?: string
  /** Expo config plugins it carries beyond the shell's own. */
  plugins?: string[]
}

export let VARIANTS = {
  'yaks-app': { name: 'yaks.app', bundle: 'app.yaks', channel: 'main' },
  // A test org's app over the checks space: proof a second app builds from
  // the same code.
  checks: {
    name: 'Checks',
    bundle: 'app.yaks.checks',
    channel: 'checks',
    space: 'checks',
  },
} satisfies Record<string, Variant>

export type Key = keyof typeof VARIANTS

/** The variant named `key`, or yaks.app's where none is named. */
export let variantOf = (key?: string) => {
  key ||= 'yaks-app'
  if (!(key in VARIANTS)) {
    throw new Error(
      `YAKS_VARIANT=${key} names no variant; native/variants.ts has ${
        Object.keys(VARIANTS).join(', ')
      }`,
    )
  }
  return { key, ...VARIANTS[key as Key] } as Variant & { key: string }
}

// The part of an Expo config a variant builds on, and what it sets there.
type Config = {
  plugins?: unknown[]
  ios?: object
  updates?: object
  extra?: object
}
type Headers = { requestHeaders?: Record<string, string> }
type Made = {
  name: string
  icon?: string
  plugins: unknown[]
  ios: { bundleIdentifier: string; appleTeamId?: string }
  updates: { requestHeaders: Record<string, string> }
  extra: { variant: Variant & { key: string }; commit?: string }
}

/** The shell's base config (app.json) made into the app `variant` is, built
 * from `commit`; the running shell reads both back from `extra`, and tags
 * what it reports with them (report.ts). */
export let configOf = <C extends Config>(
  base: C,
  variant: Variant & { key: string },
  commit?: string,
): C & Made => ({
  ...base,
  name: variant.name,
  ...(variant.icon ? { icon: variant.icon } : {}),
  plugins: [...base.plugins ?? [], ...variant.plugins ?? []],
  ios: {
    ...base.ios,
    bundleIdentifier: variant.bundle,
    ...(variant.team ? { appleTeamId: variant.team } : {}),
  },
  updates: {
    ...base.updates,
    requestHeaders: {
      ...(base.updates as Headers | undefined)?.requestHeaders,
      'expo-channel-name': variant.channel,
    },
  },
  extra: { ...base.extra, variant, ...(commit ? { commit } : {}) },
})

/** What a variant shows of the person's spaces: its own space alone where it
 * names one, holding only the apps it carries where it names them. */
export let shown = <S extends { slug: string; apps: { slug: string }[] }>(
  variant: Variant,
  spaces: S[],
): S[] =>
  spaces
    .filter((s) => !variant.space || s.slug == variant.space)
    .map((s) =>
      variant.apps
        ? { ...s, apps: s.apps.filter((a) => variant.apps!.includes(a.slug)) }
        : s
    )
