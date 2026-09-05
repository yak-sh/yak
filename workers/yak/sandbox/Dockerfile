# The builder's workbench image (sandbox.ts, T-34264): Cloudflare's own
# sandbox container, plus the least that compiles Rust to something a browser
# runs. Nothing else goes in here — an image is disk, disk is a per-second
# charge, and it is pulled before the first command of the first build.
#
# The tag MUST match the @cloudflare/sandbox version in package.json: the
# control server inside the container and the client in the Worker are two
# halves of one release, and the SDK warns at startup when they disagree.
#
# Do not add an ENTRYPOINT. The base's is `/container-server/sandbox`, which is
# the control server every tool in sandbox.ts speaks to; overriding it turns
# the container into a box nothing can reach. It already EXPOSEs 3000.
#
# Every version below is pinned and every download is checksummed, because a
# floating toolchain means a build that worked yesterday and does not today,
# and there is no one here to debug it.
FROM docker.io/cloudflare/sandbox:0.12.9

# Rust itself. `--profile minimal` is rustc, cargo and rust-std and none of
# the docs, sources or clippy — the wasm target is the only thing added, since
# that is the only thing anything here compiles for.
ARG RUST_VERSION=1.98.1
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --profile minimal \
      --default-toolchain "${RUST_VERSION}" \
      --target wasm32-unknown-unknown \
 && rustc --version && cargo --version \
 # The toolchain ships every registry index and doc it downloaded; none of it
 # is read again.
 && rm -rf "${CARGO_HOME}/registry" "${RUSTUP_HOME}/downloads"

# wasm-bindgen: what turns a `cdylib` into a .wasm plus the .js that loads it.
# The musl build is one static binary, so it needs nothing of the base's libc.
ARG WASM_BINDGEN_VERSION=0.2.128
ARG WASM_BINDGEN_SHA256=b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f
RUN set -eux; \
    name="wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl"; \
    curl -fsSL -o /tmp/wb.tgz \
      "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/${name}.tar.gz"; \
    echo "${WASM_BINDGEN_SHA256}  /tmp/wb.tgz" | sha256sum -c -; \
    tar -xzf /tmp/wb.tgz -C /usr/local/bin --strip-components=1 \
      "${name}/wasm-bindgen"; \
    rm /tmp/wb.tgz; \
    wasm-bindgen --version

# wasm-opt, out of binaryen: the pass that halves a debug .wasm. The release
# tarball is 117 MB of tools we do not run, so exactly one static-pie binary
# comes out of it — 18 MB in the image instead of 400.
ARG BINARYEN_VERSION=132
ARG BINARYEN_SHA256=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572
RUN set -eux; \
    name="binaryen-version_${BINARYEN_VERSION}"; \
    curl -fsSL -o /tmp/bn.tgz \
      "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/${name}-x86_64-linux.tar.gz"; \
    echo "${BINARYEN_SHA256}  /tmp/bn.tgz" | sha256sum -c -; \
    tar -xzf /tmp/bn.tgz -C /usr/local/bin --strip-components=2 \
      "${name}/bin/wasm-opt"; \
    rm /tmp/bn.tgz; \
    wasm-opt --version
