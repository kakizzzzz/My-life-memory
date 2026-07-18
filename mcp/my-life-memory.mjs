#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoryMcpServer } from './memory-server.mjs';

const server = await createMemoryMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
