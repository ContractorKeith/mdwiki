#!/usr/bin/env node
import { failure, success } from './output.js';
import { version } from './metadata.js';

const help = {
  name: 'mdwiki',
  version,
  usage: 'mdwiki [--json] [help|version] | mdwiki mcp',
  commands: ['help', 'version', 'mcp'],
  options: ['--help, -h', '--version, -v', '--json'],
};
const helpText = `mdwiki ${version}
Usage: ${help.usage}

Commands:
  help       Show this help
  version    Show package version
  mcp        Start stdio MCP (M0: no tools)

Options:
  --help, -h
  --version, -v
  --json     Structured help/version and errors

Vault commands are planned for later milestones.
`;

class UsageError extends Error {}

// Validate all arguments before producing output, including help requests.
function parse(args: string[]): 'help' | 'version' | 'mcp' {
  let command: string | undefined;
  let option: 'help' | 'version' | undefined;
  for (const arg of args) {
    if (arg === '--json') continue;
    if (arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v') {
      const next = arg === '--help' || arg === '-h' ? 'help' : 'version';
      if (option && option !== next) throw new UsageError('Choose help or version.');
      option = next;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else {
      if (command) throw new UsageError(`Unexpected argument: ${arg}`);
      if (!help.commands.includes(arg)) throw new UsageError(`Unknown command: ${arg}`);
      command = arg;
    }
  }
  if (command === 'mcp' && args.includes('--json')) {
    throw new UsageError('mcp uses the stdio protocol; --json is not allowed.');
  }
  if (option) return option;
  return (command ?? 'help') as 'help' | 'version' | 'mcp';
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  process.stderr.write('OUTPUT_ERROR: Could not write stdout.\n');
  process.exit(5);
});

try {
  const args = process.argv.slice(2);
  const command = parse(args);
  if (command === 'mcp') {
    const { serve } = await import('./mcp.js');
    await serve();
  } else {
    const data = command === 'help' ? help : { name: 'mdwiki', version };
    process.stdout.write(args.includes('--json')
      ? JSON.stringify(success(data)) + '\n'
      : command === 'help' ? helpText : `mdwiki ${version}\n`);
  }
} catch (error) {
  const usage = error instanceof UsageError;
  const detail = { code: usage ? 'VALIDATION_ERROR' : 'OPERATIONAL_ERROR',
    message: usage ? error.message : 'mdwiki could not start.' };
  if (process.argv.slice(2).includes('--json')) {
    process.stdout.write(JSON.stringify(failure(detail)) + '\n');
  } else {
    process.stderr.write(`${detail.code}: ${detail.message}\n`);
  }
  process.exitCode = usage ? 2 : 5;
}
