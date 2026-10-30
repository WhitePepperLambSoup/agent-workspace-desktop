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
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT),
  [electron-updater](https://github.com/electron-userland/electron-builder) (MIT), the LaTeX
  editor's [CodeMirror](https://github.com/codemirror/dev) packages and
  [Lezer highlight](https://github.com/lezer-parser/highlight) (MIT), its visual editor's
  [ProseMirror](https://github.com/ProseMirror) packages (MIT, Copyright Marijn Haverbeke and
  others), [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`, Apache-2.0), and the studio's
  [three.js](https://github.com/mrdoob/three.js) (MIT, Copyright 2010-2026 three.js authors).

## Code adapted from other projects

- The LaTeX editor follows [TeXButler](https://github.com/WhitePepperLambSoup/texbutler)
  (MIT, Copyright 2026 WhitePepperLambSoup): its log parser, source rules and fixes, SyncTeX
  search, compile scheduling, starter documents, command and symbol lists were rewritten in
  Python and TypeScript for this app, and its visual (Word-like) editor of version 1.0.0 is
  included in `desktop/src/renderer/src/latex/visual/` with small changes.
- The figure helpers of the scientific Python environment follow
  [Quick SciPlot](https://github.com/WhitePepperLambSoup/quick-sciplot) (MIT, Copyright 2026
  WhitePepperLambSoup): journal styles, exports, statistics annotations, figure templates and
  layouts, journal checks, and dragging data points back to the data rows.
- The slide-deck skill (`desktop/skills/official/skills/slide-deck`) follows the planning
  method of [PPT Master](https://github.com/hugohe3/ppt-master) (MIT, Copyright (c) 2025-2026
  Hugo He): the communication goal settled before the pages, one claim per slide with a
  conclusion as its title, a closing slide that states the takeaway, density by delivery mode,
  native charts, and the way speaker notes are written. Its text is our own; no code is copied.
- The refraction of the liquid glass material (`desktop/src/renderer/src/effects/liquid-glass/`)
  follows [liquid-glass](https://github.com/xiaojiaenen/liquid-glass) (MIT, Copyright (c)
  xiaojiaenen): a displacement map from Snell's law over a squircle bezel and a rim highlight,
  used as an SVG backdrop filter; its frosted fallback follows
  [LiquidGlass](https://github.com/LGOS-Studio/LiquidGlass) (MIT, Copyright (c) LGOS Studio). The
  code is our own.
- The studio's figures (`desktop/src/renderer/src/studio/`) follow the office of
  [Claw3D](https://github.com/iamlukethedev/Claw3D) (MIT, Copyright (c) iamlukethedev): people
  built from boxes with a sine walk cycle, desks, and status and speech labels over their heads.
  The code is our own.

All of these are under the MIT license: permission is granted, free of charge, to deal in the software
without restriction, provided the copyright notice and the permission notice are included in all
copies or substantial portions of the software; the software is provided "as is", without
warranty of any kind.

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
