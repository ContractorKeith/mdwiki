#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { NOTE_LIMIT } from './core/paths.js';
import { AppError, errorResult, success } from './output.js';
import { version } from './metadata.js';
import { initVault, selectVault } from './core/vault.js';
import { operate, schemas } from './operations.js';

const help = {
  name: 'mdwiki', version,
  usage: 'mdwiki [--vault DIR] [--index-dir DIR] [--json] COMMAND',
  commands: ['help', 'version', 'init', 'list', 'tree', 'read', 'search', 'backlinks', 'write', 'append', 'reindex', 'mcp'],
  options: ['--help, -h', '--version, -v', '--json', '--vault DIR', '--index-dir DIR'],
};
const helpText = `mdwiki ${version}
Usage: ${help.usage}

Commands:
  help                           Show this help
  version                        Show package version
  init --vault DIR               Initialize an existing directory
  list [--limit N] [--cursor T]   List exact Markdown paths (default 50, max 200)
  tree [--depth N] [--limit N]    Browse paths (depth 3, max 200 entries)
  read PATH                      Read a whole note (max 10 MiB)
  search QUERY [--tag TAG]        Search words/phrases (also --limit/--cursor)
  backlinks PATH                 Follow links (also --limit/--cursor)
  write PATH --file FILE_OR_DASH  Create; --expected-version HASH replaces
  append PATH --file FILE_OR_DASH Append latest body (both accept --dry-run)
  reindex [--full]                Reconcile or rebuild the disposable cache
  mcp                            Start stdio MCP with reads, search, backlinks and writes

Options (before or after commands):
  --help, -h
  --version, -v
  --json                         Structured results and errors
  --vault DIR                    Explicit vault; otherwise nearest initialized ancestor
  --index-dir DIR                Override initialized cache location
`;
function parse(args: string[]) {
  const options: Record<string, string> = {};
  const positional: string[] = [];
  const tags: string[] = [];
  let requested: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') { positional.push(...args.slice(i + 1)); break; }
    if (arg === '--json') continue;
    if (arg === '--full' || arg === '--dry-run') {
      if (options[arg]) throw new AppError('VALIDATION_ERROR', `Duplicate ${arg}.`);
      options[arg] = 'true'; continue;
    }
    if (arg === '--tag') {
      const tag = args[++i];
      if (!tag || tag.startsWith('--')) throw new AppError('VALIDATION_ERROR', 'Expected value for --tag.');
      tags.push(tag); continue;
    }
    if (['--help', '-h', '--version', '-v'].includes(arg)) {
      const next = arg === '--help' || arg === '-h' ? 'help' : 'version';
      if (requested && requested !== next) throw new AppError('VALIDATION_ERROR', 'Choose help or version.');
      requested = next;
    } else if (['--vault', '--index-dir', '--limit', '--cursor', '--depth', '--file', '--expected-version'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--') || options[arg] !== undefined) throw new AppError('VALIDATION_ERROR', `Expected one value for ${arg}.`);
      options[arg] = value;
    } else if (arg.startsWith('-')) throw new AppError('VALIDATION_ERROR', `Unknown option: ${arg}`);
    else positional.push(arg);
  }
  const original = positional[0] ?? 'help';
  if (!help.commands.includes(original)) throw new AppError('VALIDATION_ERROR', `Unknown command: ${original}`);
  if (original === 'mcp' && args.includes('--json')) throw new AppError('VALIDATION_ERROR', 'mcp uses the stdio protocol; --json is not allowed.');
  if (positional.length > (['read', 'search', 'backlinks', 'write', 'append'].includes(original) ? 2 : 1) || (['read', 'search', 'backlinks', 'write', 'append'].includes(original) && positional.length !== 2)) throw new AppError('VALIDATION_ERROR', 'Unexpected or missing positional argument.');
  if (!positional.length && !requested && Object.keys(options).length) throw new AppError('VALIDATION_ERROR', 'A command is required with vault options.');
  if (tags.length && original !== 'search') throw new AppError('VALIDATION_ERROR', '--tag requires search.');
  for (const flag of Object.keys(options)) {
    if (flag === '--limit' && ['list', 'tree', 'search', 'backlinks'].includes(original)) continue;
    if (flag === '--cursor' && ['list', 'search', 'backlinks'].includes(original)) continue;
    if (flag === '--expected-version' && original === 'write') continue;
    if (['--file', '--dry-run'].includes(flag) && ['write', 'append'].includes(original)) continue;
    if (flag === '--full' && original === 'reindex') continue;
    if (flag === '--depth' && original === 'tree') continue;
    if (['--vault', '--index-dir'].includes(flag)) continue;
    throw new AppError('VALIDATION_ERROR', `Option ${flag} does not apply to ${original}.`);
  }
  const input: Record<string, unknown> = {};
  for (const name of ['limit', 'depth', 'cursor']) {
    const value = options['--' + name];
    if (value !== undefined) input[name] = name === 'cursor' ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  }
  if (original === 'search') { input.query = positional[1]; if (tags.length) input.tags = tags; }
  if (original === 'reindex' && options['--full']) input.full = true;
  if (['write', 'append'].includes(original)) {
    if (!options['--file']) throw new AppError('VALIDATION_ERROR', 'write/append require --file FILE_OR_DASH.');
    input.path = positional[1];
    if (options['--dry-run']) input.dry_run = true;
    if (options['--expected-version']) input.expected_version = options['--expected-version'];
  }
  if (original === 'read' || original === 'backlinks') input.path = positional[1];
  if (original === 'list' || original === 'tree' || original === 'read' || original === 'search' || original === 'reindex' || original === 'backlinks') {
    const parsed = schemas[original].safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid command arguments.');
  }
  const selection = { ...(options['--vault'] === undefined ? {} : { vault: options['--vault'] }),
    ...(options['--index-dir'] === undefined ? {} : { indexDir: options['--index-dir'] }) };
  return { command: requested ?? original, selection, input, file: options['--file'] };
}
// Read file/stdin incrementally; reject oversize/invalid UTF-8 without truncation.
async function inputFile(file: string) {
  const handle = file === '-' ? undefined : await open(file, 'r');
  const stream = handle ? handle.createReadStream({ autoClose: false }) : process.stdin;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > NOTE_LIMIT) throw new AppError('SIZE_LIMIT', 'Input exceeds 10 MiB.');
      chunks.push(bytes);
    }
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
    catch { throw new AppError('INVALID_UTF8', 'Input is not valid UTF-8.'); }
  } finally { await handle?.close(); }
}
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  process.stderr.write('OUTPUT_ERROR: Could not write stdout.\n');
  process.exit(5);
});
try {
  const args = process.argv.slice(2);
  const { command, selection, input, file } = parse(args);
  if ((command === 'write' || command === 'append') && file) input.content = await inputFile(file);
  if (command === 'mcp') {
    const { serve } = await import('./mcp.js');
    await serve(await selectVault(selection, true));
  } else {
    const result = command === 'help' ? success(help) : command === 'version' ? success({ name: 'mdwiki', version })
      : command === 'init' ? await initVault(selection)
      : await operate(await selectVault(selection, true), command as keyof typeof schemas, input);
    if (args.includes('--json')) process.stdout.write(JSON.stringify(result) + '\n');
    else if (command === 'help') process.stdout.write(helpText);
    else if (command === 'version') process.stdout.write(`mdwiki ${version}\n`);
    else if ('content' in result.data) process.stdout.write(result.data.content as string);
    else if ('entries' in result.data) {
      for (const entry of result.data.entries) process.stdout.write(entry.path + '\n');
      if ('link_diagnostics' in result.data && Array.isArray(result.data.link_diagnostics)) for (const diagnostic of result.data.link_diagnostics) process.stderr.write(`${diagnostic.code}: ${diagnostic.path} -> ${diagnostic.occurrence.target}\n`);
      if ('next_cursor' in result.data && result.data.next_cursor) process.stderr.write(`Next cursor: ${result.data.next_cursor}\n`);
      if ('truncated' in result.data && result.data.truncated) process.stderr.write('Tree truncated; adjust --depth/--limit.\n');
    } else if (command === 'write' || command === 'append') process.stdout.write(JSON.stringify(result.data) + '\n');
    else if (command === 'reindex') process.stdout.write(JSON.stringify(result.data) + '\n');
    else process.stdout.write(`Initialized ${'vault' in result.data ? result.data.vault : ''}\n`);
    if (!args.includes('--json')) for (const diagnostic of result.diagnostics) process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n`);
    if (result.degraded) process.exitCode = 6;
  }
} catch (error) {
  const result = errorResult(error);
  if (process.argv.slice(2).includes('--json')) process.stdout.write(JSON.stringify(result) + '\n');
  else process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = error instanceof AppError ? error.exit : 5;
}
