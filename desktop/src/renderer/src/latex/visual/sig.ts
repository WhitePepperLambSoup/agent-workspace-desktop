// Content signature of a node: everything that affects its LaTeX output
// except the bookkeeping attributes (src / sig / gap). A block whose
// current signature equals the one recorded at parse time is unchanged.
import type { Node as PMNode } from "prosemirror-model";

const SKIP = new Set(["src", "sig", "gap"]);

export function sigOf(node: PMNode): string {
  if (node.isText) return `t${JSON.stringify(node.text)}${marksSig(node)}`;
  let attrs = "";
  for (const key of Object.keys(node.attrs).sort()) {
    if (SKIP.has(key)) continue;
    attrs += `${key}=${JSON.stringify(node.attrs[key])};`;
  }
  let children = "";
  node.forEach((child) => {
    children += sigOf(child) + ",";
  });
  return `${node.type.name}{${attrs}}${marksSig(node)}(${children})`;
}

function marksSig(node: PMNode): string {
  return node.marks.length ? `[${node.marks.map((m) => `${m.type.name}:${m.attrs.cmd ?? ""}`).join("|")}]` : "";
}
