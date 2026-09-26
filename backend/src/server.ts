import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@othello/shared';
import { PORT } from './config';
import { runMigrations } from './db/migrate';
import { pool } from './db/pool';
import { GameService } from './game/GameService';
import { apiRouter } from './http/routes';
import { registerSocketHandlers } from './socket/handlers';

async function main(): Promise<void> {
  // Idempotent; also run by `npm start`, but this makes `npm run dev -w backend` self-sufficient.
  await runMigrations((m) => console.log(m));

  const games = new GameService();
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', apiRouter(games));

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerSocketHandlers(io, games);

  httpServer.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));

  const shutdown = () => {
    io.close();
    httpServer.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start:', err.message ?? err);
  process.exit(1);
});
