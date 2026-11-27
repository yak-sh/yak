# @yaks/react

Render entities and kit-built views with React. The entity factory binds a view
registry and vocabulary to an entity store. Mounted entities subscribe to their
own row. A registry can contain portable renderers from @yaks/render and React
components.

The host export loads a views module into a page. Draft edits replace its
registry in place and keep the page's client, scroll and focus.

The draw export mounts a view into an element and returns its cleanup. The same
operation fills a browser element or an in-memory tree for a terminal or native
painter.
