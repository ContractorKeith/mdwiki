import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { version } from './metadata.js';

export async function serve(): Promise<void> {
  const handle = serveStdio(() => new McpServer(
    { name: 'mdwiki', version },
    { capabilities: { tools: {} } },
  ), {
    onerror: () => { process.stderr.write('MCP_PROTOCOL_ERROR: Invalid stdio message.\n'); },
  });

  // The SDK closes on stdin EOF; signals also release its transport listeners.
  const stop = () => {
    void handle.close().then(() => {
      process.stdin.pause();
    }).catch(() => {
      process.stderr.write('MCP_SHUTDOWN_ERROR: Could not close transport.\n');
      process.exitCode = 5;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
