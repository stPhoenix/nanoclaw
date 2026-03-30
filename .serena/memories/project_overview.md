# NanoClaw Project Overview

Personal Claude assistant — single Node.js/TypeScript process with skill-based channel system.

## Tech Stack
- TypeScript, Node.js 22
- Claude Agent SDK (container-based agents)
- SQLite (better-sqlite3)
- Docker containers for agent isolation
- Vitest for testing, ESLint + Prettier for linting/formatting

## Key Architecture
- Channels (WhatsApp, Telegram, Slack, Discord, Gmail) self-register at startup
- Messages route to Claude Agent SDK running in Docker containers
- Each group has isolated filesystem and memory
- IPC via file-based JSON messages between host and containers
- Credential proxy prevents secrets from entering containers

## Commands
- `npm run dev` — run with hot reload
- `npm run build` — compile TypeScript
- `npm test` — run tests (vitest)
- `./container/build.sh` — rebuild agent container
- `systemctl --user start/stop/restart nanoclaw` — Linux service management

## Code Style
- TypeScript with strict types
- ESLint + Prettier enforced
- Functional style, no classes
- Test files colocated: `*.test.ts` next to source
