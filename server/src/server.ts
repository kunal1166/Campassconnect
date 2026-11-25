import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import path from 'node:path';
import { Server as SocketServer } from 'socket.io';
import { connectDatabase, isDbConnected } from './config/db.js';
import { store } from './config/store.js';
import { verifyAuthToken } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import itemRoutes from './routes/items.js';
import notificationRoutes from './routes/notifications.js';
import shuttleRoutes from './routes/shuttles.js';
import groundingRoutes from './routes/grounding.js';
import insightsRoutes from './routes/insights.js';

const app = express();
const server = http.createServer(app);
const corsOrigin = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(s => s.trim())
  : true;
const io = new SocketServer(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST', 'PATCH'] } });
app.set('io', io);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

app.get('/api/health', (_req, res) =>
  res.status(200).json({
    status: 'ok',
    database: isDbConnected() ? 'connected' : 'in-memory',
    service: 'CampusConnect API',
    time: new Date().toISOString(),
  })
);
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/shuttles', shuttleRoutes);
app.use('/api/grounding', groundingRoutes);
app.use('/api/insights', insightsRoutes);
app.get('/api/maps-config', (_req, res) =>
  res.json({
    apiKey: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
  })
);

// Centralized API errors: keep internal stack traces out of client responses.
app.use('/api', (error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ message: 'Invalid JSON request body' });
  if (error?.name === 'MulterError') return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : 'Image upload failed' });
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid resource ID' });
  if (error?.name === 'ValidationError') return res.status(400).json({ message: 'Submitted data is invalid', details: Object.values(error.errors || {}).map((entry: any) => entry.message) });
  if (error?.message === 'Only JPEG, PNG or WEBP images are allowed' || error?.message === 'Only image uploads are allowed') return res.status(400).json({ message: error.message });
  if (error?.name === 'MongooseError' || error?.name === 'MongoNetworkError' || String(error?.message || '').includes('buffering timed out')) {
    console.warn('[AI Studio] Database offline — returning mock empty response');
    if (req.method === 'GET') {
      return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
    }
    return res.status(503).json({ message: 'Service temporarily unavailable (database offline)' });
  }
  console.error('API error:', error);
  res.status(500).json({ message: 'An unexpected server error occurred' });
});

io.on('connection', socket => {
  socket.emit('connection:ready', { connected: true, at: new Date().toISOString() });
  const handshakeToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
  const authUser = verifyAuthToken(handshakeToken);
  if (authUser?.id) socket.join(`user:${authUser.id}`);
  socket.on('user:subscribe', (token?: string) => {
    const decoded = verifyAuthToken(typeof token === 'string' ? token : undefined);
    if (decoded?.id) socket.join(`user:${decoded.id}`);
  });
  socket.on('shuttle:subscribe', (code: string) => {
    const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!cleanCode) return;
    for (const room of socket.rooms) {
      if (room.startsWith('shuttle:') && room !== `shuttle:${cleanCode}`) {
        socket.leave(room);
      }
    }
    socket.join(`shuttle:${cleanCode}`);
  });
  socket.on('shuttle:unsubscribe', (code: string) => {
    const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (cleanCode) socket.leave(`shuttle:${cleanCode}`);
  });
});

// Emit a stale-data warning through the same socket channel; client should not treat stale GPS as live.
setInterval(async () => {
  try {
    const staleBefore = new Date(Date.now() - 60_000);
    const stale = await store.findStaleShuttles(staleBefore);
    for (const shuttle of stale) io.to(`shuttle:${shuttle.code}`).emit('shuttle:stale', { code: shuttle.code, lastGpsAt: shuttle.lastGpsAt });
  } catch (error) { console.error('Stale GPS check failed', error); }
}, 30_000).unref();

const port = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET && (process.env.JWT_SECRET === 'dev_only_change_me' || process.env.JWT_SECRET.toLowerCase().includes('replace') || process.env.JWT_SECRET.length < 32)) {
  console.warn('WARNING: JWT_SECRET is weak. Set a strong 32+ char JWT_SECRET in production.');
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_only_change_me' || process.env.JWT_SECRET.toLowerCase().includes('replace')) {
  console.warn('WARNING: Using the development JWT secret. Set JWT_SECRET before any shared demo.');
}

async function start() {
  await connectDatabase();

  // Seed demo items only when this database has no item records.
  if (await store.countItems() === 0 && process.env.SEED_DEMO !== 'false') {
    await store.insertManyItems([
      { title: 'Black laptop backpack', category: 'Bags', location: 'Central Library', status: 'Found', description: 'Black backpack with front pocket', isDemo: true },
      { title: 'Blue stainless steel bottle', category: 'Accessories', location: 'Cafeteria', status: 'Found', description: 'Blue reusable bottle', isDemo: true },
      { title: 'Wireless headphones', category: 'Electronics', location: 'Academic Block', status: 'Lost', description: 'Over-ear black headphones', isDemo: true },
      { title: 'Brown leather wallet', category: 'Personal items', location: 'Main Gate', status: 'Found', description: 'Brown leather wallet', isDemo: true }
    ]);
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/') && !req.path.startsWith('/socket.io/')) {
        return res.sendFile(path.join(distDir, 'index.html'));
      }
      next();
    });
  }

  server.listen(port, '0.0.0.0', () => console.log(`CampusConnect running at http://0.0.0.0:${port}`));
}

start().catch(error => {
  console.error('Server startup failed:', error);
  process.exit(1);
});

export { app, server };