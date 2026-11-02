import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Diagnostic } from '../output.js';

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
// Extract a heading without interpreting fenced code or YAML as a title.
function firstHeading(body: string) {
  let fence: string | undefined;
  let previous = '';
  let comment = false;
  for (let line of body.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length
        && /^ {0,3}(?:`+|~+)[ \t]*$/.test(line)) fence = undefined;
      continue;
    }
    if (!comment && marker) { fence = marker; previous = ''; continue; }
    // Comment markers inside fenced code are literal; elsewhere omit comment text.
    let visible = '';
    while (line) {
      const delimiter = comment ? '-->' : '<!--';
      const at = line.indexOf(delimiter);
      if (at < 0) { if (!comment) visible += line; break; }
      if (!comment) visible += line.slice(0, at);
      line = line.slice(at + delimiter.length);
      comment = !comment;
    }
    line = visible;
    const heading = /^ {0,3}#{1,6}[ \t]+([^\r\n]+)$/.exec(line)?.[1];
    if (heading) {
      const title = heading.replace(/[ \t]+#+[ \t]*$/, '').trim();
      if (title) return title;
    }
    if (previous && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) return previous;
    previous = line.trim();
  }
  return undefined;
}
// The document retains tokens/comments; public JSON represents unsafe integers lexically.
export function frontmatter(content: string, path: string) {
  const diagnostics: Diagnostic[] = [];
  const scalars: string[] = [];
  const invalidTypes = new Set<string>();
  const text = content.replace(/^\uFEFF/, '');
  let body = text;
  let metadata: { [key: string]: Value } = Object.create(null) as { [key: string]: Value };
  if (/^---\r?\n/.test(text)) {
    const closing = /\r?\n(?:---|\.\.\.)(?:\r?\n|$)/g;
    closing.lastIndex = text.indexOf('\n');
    const end = closing.exec(text);
    try {
      if (!end) throw new Error('Unterminated frontmatter.');
      body = text.slice(end.index + end[0].length);
      const doc = parseDocument(text.slice(text.indexOf('\n') + 1, end.index), {
        version: '1.2', schema: 'core', intAsBigInt: true, keepSourceTokens: true,
        uniqueKeys: true, strict: true,
      });
      if (doc.errors.length || doc.warnings.length) throw new Error('Malformed or unsupported YAML.');
      let aliases = 0;
      let nodes = 0;
      const active = new Set<unknown>();
      const convert = (node: unknown, depth: number): Value => {
        if (++nodes > 100_000 || depth > 50) throw new Error('YAML nesting or expansion limit exceeded.');
        if (node === null) return null;
        if (active.has(node)) throw new Error('Cyclic YAML aliases.');
        active.add(node);
        try {
          if (isAlias(node)) {
            if (++aliases > 100) throw new Error('YAML alias limit exceeded.');
            return convert(node.resolve(doc), depth + 1);
          }
          if (isScalar(node)) {
            if (node.tag && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float',
              'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null'].includes(node.tag)) throw new Error('Unsupported YAML tag.');
            const value: unknown = node.value;
            if (value !== null) scalars.push(typeof value === 'string' ? value : node.source ?? String(value));
            if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
              ? Number(value) : node.source ?? value.toString();
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite YAML number.');
            if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
            throw new Error('Unsupported YAML scalar.');
          }
          if (isSeq(node)) {
            if (node.tag && node.tag !== 'tag:yaml.org,2002:seq') throw new Error('Unsupported YAML tag.');
            return node.items.map((item) => convert(item, depth + 1));
          }
          if (isMap(node)) {
            if (node.tag && node.tag !== 'tag:yaml.org,2002:map') throw new Error('Unsupported YAML tag.');
            const result: { [key: string]: Value } = Object.create(null) as { [key: string]: Value };
            for (const pair of node.items) {
              if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('YAML keys must be strings.');
              result[pair.key.value] = convert(pair.value, depth + 1);
            }
            return result;
          }
          throw new Error('Unsupported YAML value.');
        } finally { active.delete(node); }
      };
      if (!isMap(doc.contents)) throw new Error('Frontmatter must be a mapping.');
      metadata = convert(doc.contents, 0) as { [key: string]: Value };
      // Validate original YAML scalar types independently of JSON conversion.
      // Conversion above has already rejected cyclic/excessive alias expansion.
      const resolved = (node: unknown): unknown => isAlias(node) ? resolved(node.resolve(doc)) : node;
      const stringNode = (node: unknown) => {
        const value = resolved(node);
        return isScalar(value) && typeof value.value === 'string';
      };
      for (const key of ['title', 'created', 'updated', 'tags']) {
        if (!doc.has(key)) continue;
        const node = resolved(doc.get(key, true));
        if (key === 'tags' ? !isSeq(node) || !node.items.every(stringNode) : !stringNode(node)) invalidTypes.add(key);
      }
    } catch (error) {
      diagnostics.push({ code: 'INVALID_FRONTMATTER', message: (error as Error).message, path });
    }
  }
  const date = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  const validDate = (value: Value) => {
    if (typeof value !== 'string' || !date.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const day = value.slice(0, 10);
    return new Date(day).toISOString().slice(0, 10) === day;
  };
  for (const [key, value] of Object.entries(metadata)) {
    const valid = key === 'title' ? typeof value === 'string' && !!value.trim()
      : key === 'tags' ? Array.isArray(value) && value.every((tag) => typeof tag === 'string')
      : key === 'created' || key === 'updated' ? validDate(value) : true;
    if (!valid || invalidTypes.has(key)) diagnostics.push({ code: 'INVALID_METADATA', message: `Invalid managed field: ${key}.`, path });
  }
  const title = !invalidTypes.has('title') && typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title
    : firstHeading(body) ?? path.split('/').at(-1)!.replace(/\.md$/i, '');
  const invalid = diagnostics.some((d) => d.code === 'INVALID_FRONTMATTER');
  return { metadata, title, diagnostics, body: invalid ? content : body,
    metadataText: invalid ? '' : scalars.join('\n'),
    tags: !invalid && !invalidTypes.has('tags') && Array.isArray(metadata.tags)
      && metadata.tags.every((tag) => typeof tag === 'string') ? metadata.tags as string[] : [] };
}
