import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { schemas, toolResult } from './operations.js';
import type { Vault } from './core/vault.js';
import { version } from './metadata.js';

export async function serve(vault: Vault): Promise<void> {
  const handle = serveStdio(() => {
    const server = new McpServer({ name: 'mdwiki', version }, { capabilities: { tools: {} } });
    for (const operation of ['list', 'tree', 'read'] as const) {
      const schema = schemas[operation];
      // Advertise the precise schema; validate in the shared operation so valid
      // tool envelopes with bad arguments get our stable application envelope.
      const inputSchema = {
        '~standard': {
          version: 1 as const, vendor: 'mdwiki',
          validate: (value: unknown) => ({ value }),
          jsonSchema: { input: () => z.toJSONSchema(schema), output: () => z.toJSONSchema(schema) },
        },
      };
      server.registerTool(`mdwiki_${operation}`, {
        description: `${operation} notes in the selected vault`, inputSchema,
      }, async (input) => {
        const result = await toolResult(vault, operation, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result, isError: !result.ok };
      });
    }
    return server;
  }, {
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
