// Component faces are loaded only by a browser or terminal painter.
export let componentViews = () =>
  import('./component-views.tsx').then((m) => m.views)
