import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import path from 'node:path';
import { Server as SocketServer } from 'socket.io';
import { connectDatabase } from './config/db.js';
import authRoutes from './routes/auth.js';
import itemRoutes from './routes/items.js';
import notificationRoutes from './routes/notifications.js';
import shuttleRoutes from './routes/shuttles.js';
import { Item } from './models/Item.js';
import { Shuttle } from './models/Shuttle.js';
import mongoose from 'mongoose';

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(s => s.trim());
const io = new SocketServer(server, { cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PATCH'] } });
app.set('io', io);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

app.get('/api/health', (_req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', service: 'CampusConnect API', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/shuttles', shuttleRoutes);

// Centralized API errors: keep internal stack traces out of client responses.
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ message: 'Invalid JSON request body' });
  if (error?.name === 'MulterError') return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : 'Image upload failed' });
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid resource ID' });
  if (error?.name === 'ValidationError') return res.status(400).json({ message: 'Submitted data is invalid', details: Object.values(error.errors || {}).map((entry: any) => entry.message) });
  if (error?.message === 'Only JPEG, PNG or WEBP images are allowed') return res.status(400).json({ message: error.message });
  console.error('API error:', error);
  res.status(500).json({ message: 'An unexpected server error occurred' });
});

io.on('connection', socket => {
  socket.emit('connection:ready', { connected: true, at: new Date().toISOString() });
  socket.on('shuttle:subscribe', (code: string) => socket.join(`shuttle:${String(code).toUpperCase()}`));
});

// Emit a stale-data warning through the same socket channel; client should not treat stale GPS as live.
setInterval(async () => {
  try {
    const staleBefore = new Date(Date.now() - 60_000);
    const stale = await Shuttle.find({ active: true, lastGpsAt: { $lt: staleBefore } }).select('code lastGpsAt');
    for (const shuttle of stale) io.to(`shuttle:${shuttle.code}`).emit('shuttle:stale', { code: shuttle.code, lastGpsAt: shuttle.lastGpsAt });
  } catch (error) { console.error('Stale GPS check failed', error); }
}, 30_000).unref();

const port = Number(process.env.PORT || 5000);
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_only_change_me' || process.env.JWT_SECRET.toLowerCase().includes('replace') || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Set a strong JWT_SECRET (at least 32 characters) before starting in production.');
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_only_change_me' || process.env.JWT_SECRET.toLowerCase().includes('replace')) {
  console.warn('WARNING: Using the development JWT secret. Set JWT_SECRET in server/.env before any shared demo.');
}
connectDatabase().then(async () => {
  // Ensure route definitions exist; GPS coordinates arrive only from opted-in driver devices.
  const routeSeeds = [
    { code: 'R1', routeName: 'Main Gate – Academic Block', origin: 'Main Gate', destination: 'Academic Block', stops: ['Main Gate', 'Library', 'Academic Block'] },
    { code: 'R2', routeName: 'Hostel – Cafeteria', origin: 'Hostel', destination: 'Cafeteria', stops: ['Hostel', 'Main Gate', 'Cafeteria'] },
    { code: 'R3', routeName: 'Library – Auditorium', origin: 'Library', destination: 'Auditorium', stops: ['Library', 'Academic Block', 'Auditorium'] }
  ];
  for (const route of routeSeeds) await Shuttle.updateOne({ code: route.code }, { $setOnInsert: route }, { upsert: true });
  // Seed demo items only when this database has no item records.
  if (await Item.countDocuments() === 0 && process.env.SEED_DEMO !== 'false') {
    await Item.insertMany([
      { title: 'Black laptop backpack', category: 'Bags', location: 'Central Library', status: 'Found', description: 'Black backpack with front pocket', isDemo: true },
      { title: 'Blue stainless steel bottle', category: 'Accessories', location: 'Cafeteria', status: 'Found', description: 'Blue reusable bottle', isDemo: true },
      { title: 'Wireless headphones', category: 'Electronics', location: 'Academic Block', status: 'Lost', description: 'Over-ear black headphones', isDemo: true },
      { title: 'Brown leather wallet', category: 'Personal items', location: 'Main Gate', status: 'Found', description: 'Brown leather wallet', isDemo: true }
    ]);
  }
  server.listen(port, () => console.log(`CampusConnect API running at http://localhost:${port}`));
}).catch(error => {
  console.error('Database connection failed:', error.message);
  console.error('Check MONGODB_URI in server/.env. Local MongoDB must be running, or use an Atlas connection string.');
  process.exit(1);
});

export { app, server };