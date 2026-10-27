# Third-Party Notices

Agent Workspace is licensed under Apache-2.0. The software it is built on keeps its own licenses.
This summary lists the components the Windows release ships; it does not replace their licenses.

## Desktop shell

- [Electron](https://github.com/electron/electron), MIT, with Chromium and Node.js. The release
  folder carries `LICENSE.electron.txt` and `LICENSES.chromium.html`, which list Chromium's own
  third-party components and their licenses.
- Renderer packages: [React and React DOM](https://github.com/facebook/react) (MIT),
  [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm),
  [remark-math and rehype-katex](https://github.com/remarkjs/remark-math) and
  [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) (MIT), [KaTeX](https://github.com/KaTeX/KaTeX)
  (MIT), [Shiki](https://github.com/shikijs/shiki) (MIT), [TanStack Virtual](https://github.com/TanStack/virtual)
  (MIT), [Lucide](https://github.com/lucide-icons/lucide) (ISC), [Zod](https://github.com/colinhacks/zod) (MIT),
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) and
  [electron-updater](https://github.com/electron-userland/electron-builder) (MIT).

## Python runtime (the sidecar)

- Direct dependencies: [cryptography](https://github.com/pyca/cryptography) (Apache-2.0 OR
  BSD-3-Clause), [HTTPX](https://github.com/encode/httpx) (BSD-3-Clause),
  [jsonschema](https://github.com/python-jsonschema/jsonschema) (MIT), [pypdf](https://github.com/py-pdf/pypdf)
  (BSD-3-Clause), [tomli-w](https://github.com/hukkin/tomli-w) (MIT) and
  [websockets](https://github.com/python-websockets/websockets) (BSD-3-Clause).
- Their dependencies include httpcore and idna (BSD-3-Clause), anyio, h11, attrs, referencing,
  rpds-py and jsonschema-specifications (MIT), cffi (MIT-0), pycparser (BSD-3-Clause) and
  certifi (MPL-2.0).
- CPython is distributed under the Python Software Foundation License. The sidecar is frozen with
  [PyInstaller](https://github.com/pyinstaller/pyinstaller), whose bootloader is GPL-2.0 with an
  exception that allows distributing it with programs under other licenses.

The unmodified MPL-2.0 `certifi` 2026.10.23 source is available at
https://files.pythonhosted.org/packages/fd/11/b524cbd9bbdaca58608e4cf4053fd463417549e1959fa8d3aa18319f9555/certifi-2026.10.23.tar.gz
(136225 bytes; SHA-256 `a9895e6e2758b371e0545e321a3a8fd1fcfd9829ada8824a936dfb16aaaf36cd`).

## In every release

Each release folder contains a CycloneDX SBOM (`electron-sbom.json`) with the exact version of
every packaged component, `SHA256SUMS.txt` for its files and `ELECTRON-RELEASE.json` describing the
build. Development tools (test runners, type checkers, bundlers) are not part of the release.
