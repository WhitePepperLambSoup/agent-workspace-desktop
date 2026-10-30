// Low-level LaTeX scanning: balanced groups, comments, environment ends.

/** Environments whose body is not LaTeX (skipped literally). */
export const VERBATIM_ENVS = new Set(["verbatim", "verbatim*", "lstlisting", "minted", "comment", "Verbatim", "BVerbatim"]);

/** True when the char at `i` is escaped by an odd run of backslashes. */
export function isEscaped(s: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) n++;
  return n % 2 === 1;
}

/** Index of the unescaped `%` starting a comment on the line of `from`, or -1. */
export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "%" && !isEscaped(line, i)) return i;
  }
  return -1;
}

/** End of line (index of "\n" or s.length) starting at `i`. */
export function lineEnd(s: string, i: number): number {
  const n = s.indexOf("\n", i);
  return n < 0 ? s.length : n;
}

/**
 * `s[i]` is `{`: index just after the matching `}`, or -1. Escaped braces
 * are skipped; with `comments`, `%` comments are skipped too.
 */
export function matchBrace(s: string, i: number, comments = true): number {
  if (s[i] !== "{") return -1;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++; // skip the escaped char (\{ \} \% \\)
      continue;
    }
    if (comments && c === "%") {
      j = lineEnd(s, j);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return -1;
}

/** `s[i]` is `[`: index just after the matching `]` (braces respected), or -1. */
export function matchBracket(s: string, i: number): number {
  if (s[i] !== "[") return -1;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "{") {
      const e = matchBrace(s, j);
      if (e < 0) return -1;
      j = e - 1;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return j + 1;
  }
  return -1;
}

/** Read `\name` at `i` (s[i] === "\\"): the command name ("" for a control symbol). */
export function commandName(s: string, i: number): string {
  let j = i + 1;
  while (j < s.length && /[A-Za-z@]/.test(s[j])) j++;
  return s.slice(i + 1, j);
}

/** Skip spaces/tabs (not newlines). */
export function skipSpaces(s: string, i: number): number {
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return i;
}

/** Skip all whitespace. */
export function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/**
 * `s[i]` starts `\begin{name}`: returns name and the indices of the
 * matching `\end{name}` (start, end), or null when unbalanced.
 */
export function findEnvEnd(s: string, i: number): { name: string; beginEnd: number; endStart: number; endEnd: number } | null {
  const m = /^\\begin\s*\{([^}]+)\}/.exec(s.slice(i, i + 200));
  if (!m) return null;
  const name = m[1];
  const beginEnd = i + m[0].length;
  if (VERBATIM_ENVS.has(name)) {
    const close = `\\end{${name}}`;
    const at = s.indexOf(close, beginEnd);
    return at < 0 ? null : { name, beginEnd, endStart: at, endEnd: at + close.length };
  }
  const stack: string[] = [name];
  let j = beginEnd;
  while (j < s.length) {
    const c = s[j];
    if (c === "%" && !isEscaped(s, j)) {
      j = lineEnd(s, j);
      continue;
    }
    if (c === "\\") {
      const rest = s.slice(j, j + 200);
      const b = /^\\begin\s*\{([^}]+)\}/.exec(rest);
      if (b) {
        if (VERBATIM_ENVS.has(b[1])) {
          const close = `\\end{${b[1]}}`;
          const at = s.indexOf(close, j + b[0].length);
          if (at < 0) return null;
          j = at + close.length;
          continue;
        }
        stack.push(b[1]);
        j += b[0].length;
        continue;
      }
      const e = /^\\end\s*\{([^}]+)\}/.exec(rest);
      if (e) {
        if (stack[stack.length - 1] !== e[1]) return null; // mismatched nesting
        stack.pop();
        if (stack.length === 0) return { name, beginEnd, endStart: j, endEnd: j + e[0].length };
        j += e[0].length;
        continue;
      }
      j += 2;
      continue;
    }
    j++;
  }
  return null;
}

/** Split `s` at top-level occurrences of `sep` (outside braces, comments, nested envs). */
export function splitTopLevel(s: string, sep: (s: string, i: number) => number): { start: number; end: number; sepEnd: number }[] {
  const out: { start: number; end: number; sepEnd: number }[] = [];
  let start = 0;
  let j = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === "%" && !isEscaped(s, j)) {
      j = lineEnd(s, j);
      continue;
    }
    if (c === "{" && !isEscaped(s, j)) {
      const e = matchBrace(s, j);
      j = e < 0 ? s.length : e;
      continue;
    }
    if (c === "\\" && s.startsWith("\\begin", j)) {
      const env = findEnvEnd(s, j);
      if (env) {
        j = env.endEnd;
        continue;
      }
    }
    const len = sep(s, j);
    if (len > 0) {
      out.push({ start, end: j, sepEnd: j + len });
      j += len;
      start = j;
      continue;
    }
    j += c === "\\" ? 2 : 1;
  }
  out.push({ start, end: s.length, sepEnd: s.length });
  return out;
}
