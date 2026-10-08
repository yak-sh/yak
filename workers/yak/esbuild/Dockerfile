# The compiler's container (wrangler.toml beside this file, D-40376): Deno
# serving @yaks/esbuild's compile on port 8080, with native esbuild beside it.
# The Worker in front posts each app's ask here with the toolkit catalog.
#
# The build context is packages/esbuild itself (wrangler.toml
# `image_build_context`), so this image changes only when the compiler does:
# the toolkit catalog, which changes with every package, rides each request
# instead. The package pins every npm import exactly (its deno.json), and
# `deno cache` fetches them here, native esbuild for linux/amd64 included, so
# a container that starts downloads nothing before its first compile.
FROM denoland/deno:debian-2.9.1

WORKDIR /compiler
COPY . .
RUN deno cache --config deno.json compile.ts

EXPOSE 8080
CMD ["deno", "serve", "--allow-net", "--allow-read", "--allow-env", "--allow-run", "--allow-sys", "--port", "8080", "--config", "deno.json", "compile.ts"]
