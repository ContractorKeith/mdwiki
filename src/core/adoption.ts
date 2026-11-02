import { Document, isMap, isNode, parseDocument } from 'yaml';
import { frontmatter, firstHeading } from './frontmatter.js';
import { AppError } from '../output.js';

function parsed(content: string, path: string) {
  const result = frontmatter(content, path);
  if (result.diagnostics.length) throw new AppError('VALIDATION_ERROR', 'Writes require valid supported YAML and managed metadata: ' + result.diagnostics.map(d => d.message).join(' '));
  const text = content.replace(/^\uFEFF/, '');
  const end = /^---\r?\n/.test(text) ? /\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text.slice(text.indexOf('\n'))) : null;
  const yaml = end ? text.slice(text.indexOf('\n') + 1, text.indexOf('\n') + end.index) : undefined;
  const doc = yaml === undefined ? new Document({}) : parseDocument(yaml, {
    version: '1.2', schema: 'core', intAsBigInt: true, keepSourceTokens: true,
  });
  return { ...result, doc };
}

// Edit document nodes rather than round-tripping JSON (which rounds big integers).
// YAML's serializer normalizes e.g. +001, 1e3 and quoted escapes; retain
// original single-line scalar tokens. Collections/block strings keep YAML semantics.
export function adopt(path: string, current: string | undefined, input: string, append: boolean, now: string) {
  const original = parsed(current ?? '', path);
  const supplied = append ? undefined : parsed(input, path);
  const doc = current === undefined ? supplied!.doc : original.doc;
  const suppliedKeys = new Set<string>();
  if (current !== undefined && supplied && isMap(supplied.doc.contents) && isMap(doc.contents)) {
    for (const pair of supplied.doc.contents.items) {
      const key = String(pair.key);
      suppliedKeys.add(key);
      const priorPair = doc.contents.items.find(item => String(item.key) === key);
      if (!priorPair) { doc.add(pair); continue; }
      if (isNode(priorPair.key) && isNode(pair.key) && pair.key.commentBefore) {
        priorPair.key.commentBefore = [priorPair.key.commentBefore, pair.key.commentBefore].filter(Boolean).join('\n');
      }
      const prior = doc.get(key, true);
      if (isNode(prior) && isNode(pair.value)) {
        if (prior.commentBefore) pair.value.commentBefore = [prior.commentBefore, pair.value.commentBefore].filter(Boolean).join('\n');
        if (prior.comment) pair.value.comment = [prior.comment, pair.value.comment].filter(Boolean).join('\n');
      }
      doc.set(key, pair.value);
    }
  }
  let body = supplied?.body ?? original.body;
  const newline = (current ?? input).includes('\r\n') ? '\r\n' : '\n';
  if (append) body += body && !body.endsWith('\n') && input ? newline + input : input;
  // Body input follows the existing note's newline convention; no Markdown reflow.
  body = body.replace(/\r?\n/g, newline);
  if (!doc.has('title')) doc.set('title', firstHeading(body) ?? path.split('/').at(-1)!.replace(/\.md$/i, ''));
  if (!doc.has('created')) doc.set('created', now);
  const updated = doc.createNode(now);
  const priorUpdated = doc.get('updated', true);
  if (isNode(priorUpdated)) {
    if (priorUpdated.comment !== undefined) updated.comment = priorUpdated.comment;
    if (priorUpdated.commentBefore !== undefined) updated.commentBefore = priorUpdated.commentBefore;
  }
  doc.set('updated', updated);
  if (!doc.has('tags')) doc.set('tags', []);
  doc.schema.tags = doc.schema.tags.map(tag => {
    if (!('stringify' in tag) || !tag.stringify) return tag;
    const stringify = tag.stringify;
    return { ...tag, stringify: (node, ctx, onComment, onChompKeep) => {
      const token = node.srcToken;
      if (token && ['scalar', 'single-quoted-scalar', 'double-quoted-scalar'].includes(token.type)
        && 'source' in token && !/[\r\n]/.test(token.source)) return token.source;
      return stringify(node, ctx, onComment, onChompKeep);
    } } as typeof tag;
  });
  const bom = (current ?? input).startsWith('\uFEFF') ? '\uFEFF' : '';
  let yaml: string;
  try { yaml = doc.toString({ lineWidth: 0 }); }
  catch { throw new AppError('VALIDATION_ERROR', 'Cannot preserve YAML anchors after metadata merge.'); }
  const result = bom + '---' + newline + yaml.replace(/\r?\n/g, newline) + '---' + newline + body;
  // Merging anchors can invalidate aliases; refuse rather than reinterpret them.
  const checked = parsed(result, path);
  for (const [key, value] of Object.entries(original.metadata)) {
    if (key !== 'updated' && !suppliedKeys.has(key)
      && JSON.stringify(value) !== JSON.stringify(checked.metadata[key])) {
      throw new AppError('VALIDATION_ERROR', 'Metadata merge would reinterpret an omitted field through a changed YAML anchor.');
    }
  }
  return result;
}
