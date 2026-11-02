import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import { notePath } from './paths.js';

export interface Occurrence { target: string; fragment: string; embed: boolean; offset: number; line: number; column: number; context: string }
export interface LinkNote { path: string; aliases: string[] }
// Parse Markdown only to identify excluded syntax; retain original offsets/spelling.
export function parseLinks(content: string): Occurrence[] {
  if (!content.includes('[[')) return [];
  const text = content.replace(/^\uFEFF/, ' ');
  let start = 0;
  if (/^(?:\uFEFF)?---\r?\n/.test(content)) {
    const end = /\r?\n(?:---|\.\.\.)(?:\r?\n|$)/g;
    end.lastIndex = text.indexOf('\n');
    const match = end.exec(text);
    start = match ? match.index + match[0].length : text.length;
  }
  const body = text.slice(start);
  const excluded: [number, number][] = [];
  const visit = (node: Nodes) => {
    if (['code', 'inlineCode'].includes(node.type)) {
      excluded.push([node.position!.start.offset!, node.position!.end.offset!]);
    } else if (node.type === 'html') {
      const source = body.slice(node.position!.start.offset!, node.position!.end.offset!);
      for (const comment of source.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
        const at = node.position!.start.offset! + comment.index;
        excluded.push([at, at + comment[0].length]);
      }
    } else if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(body));
  // Mask excluded ranges without changing offsets or joining separate text runs.
  let visible = ''; let cursor = 0;
  for (const [a, b] of excluded) { visible += body.slice(cursor, a) + ' '.repeat(b - a); cursor = b; }
  visible += body.slice(cursor);
  const result: Occurrence[] = [];
  const lines = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines.push(i + 1);
  let line = 0;
  for (const match of visible.matchAll(/!?\[\[([^[\]\r\n]*)\]\]/g)) {
    const at = match.index;
    let slashes = 0;
    for (let i = at - 1; i >= 0 && visible[i] === '\\'; i--) slashes++;
    if (slashes % 2) continue;
    const raw = match[1]!.split('|', 1)[0]!;
    const hash = raw.indexOf('#');
    const target = (hash < 0 ? raw : raw.slice(0, hash)).trim();
    const fragment = hash < 0 ? '' : raw.slice(hash + 1);
    const embed = match[0].startsWith('!');
    if (embed && /\.[^/.]+$/.test(target) && !/\.md$/i.test(target)) continue;
    if (!target && hash < 0) continue;
    const offset = start + at;
    while (line + 1 < lines.length && lines[line + 1]! <= offset) line++;
    result.push({ target: target.slice(0, 4097), fragment: fragment.slice(0, 4096), embed, offset, line: line + 1, column: offset - lines[line]! + 1,
      context: content.slice(Math.max(start, offset - 80), offset + Math.min(match[0].length, 160) + 80) });
  }
  return result;
}
export function linkResolver(notes: LinkNote[]) {
  const paths = new Set(notes.map((n) => n.path));
  const stems = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>(), aliases = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, path: string) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(path);
  };
  for (const note of notes) {
    add(stems, note.path.replace(/\.md$/i, ''), note.path);
    const name = note.path.split('/').at(-1)!;
    add(names, name, note.path); add(names, name.replace(/\.md$/i, ''), note.path);
    for (const alias of note.aliases) add(aliases, alias, note.path);
  }
  return (source: string, target: string) => {
    if (!target) return { resolved: source, code: '', candidates: [] as string[], candidate_count: 0 };
    const finish = (candidates: string[]) => ({ resolved: candidates.length === 1 ? candidates[0]! : null,
      code: candidates.length === 1 ? '' : candidates.length > 1 ? 'AMBIGUOUS_LINK' : 'MISSING_LINK', candidates: candidates.slice(0, 200), candidate_count: candidates.length });
    try { notePath(/\.md$/i.test(target) ? target : target + '.md'); }
    catch { return { ...finish([]), code: 'INVALID_LINK' }; }
    const exact = (base: string) => /\.md$/i.test(target) ? (paths.has(base) ? [base] : [])
      : [...new Set([...(paths.has(base) ? [base] : []), ...(stems.get(base) ?? [])])];
    const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
    for (const stage of [() => exact(folder + target), () => exact(target), () => [...(names.get(target) ?? [])], () => [...(aliases.get(target) ?? [])]]) {
      const candidates = stage();
      if (candidates.length) return finish(candidates.sort());
    }
    return finish([]);
  };
}
