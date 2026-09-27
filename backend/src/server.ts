import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@othello/shared';
import { PORT, WEB_ORIGINS } from './config';
import { runMigrations } from './db/migrate';
import { pool } from './db/pool';
import { GameService } from './game/GameService';
import { apiRouter } from './http/routes';
import { AnalysisRunner } from './analysis/AnalysisRunner';
import { registerSocketHandlers, roomFor } from './socket/handlers';

/**
 * CORS for the deployed web app on its own domain. Bearer tokens, not cookies, so no credentials.
 * Unlisted origins get no CORS headers, and the browser blocks them.
 */
function allowWebOrigins(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && WEB_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

async function main(): Promise<void> {
  // Idempotent; also run by `npm start`, but this makes `npm run dev -w backend` self-sufficient.
  await runMigrations((m) => console.log(m));

  const games = new GameService();
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: WEB_ORIGINS.length ? { origin: WEB_ORIGINS } : undefined,
  });
  registerSocketHandlers(io, games);

  const analysis = new AnalysisRunner(games, {
    progress: (p) => io.to(roomFor(p.gameId)).emit('analysis:progress', p),
    ready: (p) => io.to(roomFor(p.gameId)).emit('analysis:ready', p),
  });

  app.disable('x-powered-by');
  app.use('/api', allowWebOrigins, apiRouter(games, analysis));

  httpServer.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));

  const requeued = await analysis.requeueOnBoot();
  if (requeued > 0) console.log(`[analysis] re-queued ${requeued} game(s) from a previous run`);

  const shutdown = () => {
    analysis.stop();
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
