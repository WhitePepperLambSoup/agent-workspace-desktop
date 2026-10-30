import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { c, cpp, csharp, dart, java, kotlin, scala } from '@codemirror/legacy-modes/mode/clike'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { css, less, sCSS } from '@codemirror/legacy-modes/mode/css'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { go } from '@codemirror/legacy-modes/mode/go'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { python } from '@codemirror/legacy-modes/mode/python'
import { r } from '@codemirror/legacy-modes/mode/r'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { standardSQL } from '@codemirror/legacy-modes/mode/sql'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { html, xml } from '@codemirror/legacy-modes/mode/xml'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'

/** A file kind the editor colours, and what the language server calls it. */
export interface CodeLanguage {
  name: string
  parser: StreamParser<unknown>
}

const BY_EXTENSION: Record<string, CodeLanguage> = {}

function add(parser: StreamParser<unknown>, name: string, ...extensions: string[]): void {
  for (const extension of extensions) BY_EXTENSION[extension] = { name, parser }
}

add(python as StreamParser<unknown>, 'python', 'py', 'pyi', 'pyw')
add(typescript as StreamParser<unknown>, 'typescript', 'ts', 'tsx', 'mts', 'cts')
add(javascript as StreamParser<unknown>, 'javascript', 'js', 'jsx', 'mjs', 'cjs')
add(json as StreamParser<unknown>, 'json', 'json', 'jsonc', 'json5')
add(rust as StreamParser<unknown>, 'rust', 'rs')
add(go as StreamParser<unknown>, 'go', 'go')
add(c as StreamParser<unknown>, 'c', 'c', 'h')
add(cpp as StreamParser<unknown>, 'cpp', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx')
add(java as StreamParser<unknown>, 'java', 'java')
add(kotlin as StreamParser<unknown>, 'kotlin', 'kt', 'kts')
add(csharp as StreamParser<unknown>, 'csharp', 'cs')
add(scala as StreamParser<unknown>, 'scala', 'scala', 'sc')
add(dart as StreamParser<unknown>, 'dart', 'dart')
add(swift as StreamParser<unknown>, 'swift', 'swift')
add(ruby as StreamParser<unknown>, 'ruby', 'rb')
add(lua as StreamParser<unknown>, 'lua', 'lua')
add(perl as StreamParser<unknown>, 'perl', 'pl', 'pm')
add(r as StreamParser<unknown>, 'r', 'r')
add(julia as StreamParser<unknown>, 'julia', 'jl')
add(haskell as StreamParser<unknown>, 'haskell', 'hs')
add(shell as StreamParser<unknown>, 'shell', 'sh', 'bash', 'zsh')
add(powerShell as StreamParser<unknown>, 'powershell', 'ps1', 'psm1')
add(standardSQL as StreamParser<unknown>, 'sql', 'sql')
add(css as StreamParser<unknown>, 'css', 'css')
add(sCSS as StreamParser<unknown>, 'scss', 'scss')
add(less as StreamParser<unknown>, 'less', 'less')
add(html as StreamParser<unknown>, 'html', 'html', 'htm', 'vue', 'svelte')
add(xml as StreamParser<unknown>, 'xml', 'xml', 'svg', 'xaml', 'csproj', 'props', 'targets')
add(yaml as StreamParser<unknown>, 'yaml', 'yml', 'yaml')
add(toml as StreamParser<unknown>, 'toml', 'toml')
add(properties as StreamParser<unknown>, 'ini', 'ini', 'cfg', 'conf', 'properties', 'env')
add(diff as StreamParser<unknown>, 'diff', 'diff', 'patch')
add(cmake as StreamParser<unknown>, 'cmake', 'cmake')

const BY_NAME: Record<string, CodeLanguage> = {
  dockerfile: { name: 'dockerfile', parser: dockerFile as StreamParser<unknown> },
  'cmakelists.txt': { name: 'cmake', parser: cmake as StreamParser<unknown> },
  makefile: { name: 'shell', parser: shell as StreamParser<unknown> },
}

export function languageFor(path: string): CodeLanguage | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (BY_NAME[name]) return BY_NAME[name]!
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? BY_EXTENSION[name.slice(dot + 1)] ?? null : null
}

const languages = new Map<CodeLanguage, StreamLanguage<unknown>>()

/** The CodeMirror language for a file, made once per kind. */
export function streamLanguageFor(path: string): StreamLanguage<unknown> | null {
  const found = languageFor(path)
  if (!found) return null
  let language = languages.get(found)
  if (!language) {
    language = StreamLanguage.define(found.parser)
    languages.set(found, language)
  }
  return language
}
