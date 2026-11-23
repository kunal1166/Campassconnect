import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Item } from '../models/Item.js';
import { Notification } from '../models/Notification.js';
import { optionalAuth, requireAuth, type AuthRequest } from '../middleware/auth.js';

const router = Router();
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'));
  cb(null, true);
}});

async function createImageEmbedding(filePath?: string): Promise<number[] | undefined> {
  if (!filePath) return undefined;
  try {
    const bytes = await readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'item-image.jpg');
    const response = await fetch(`${process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000'}/embed`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    if (!response.ok) return undefined;
    const data = await response.json() as { embedding?: number[] };
    return data.embedding;
  } catch (error) {
    console.warn('CLIP service unavailable; report saved without image embedding.');
    return undefined;
  }
}

function cosine(a: number[] = [], b: number[] = []) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function tokenSimilarity(a: string, b: string) {
  const words = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const aa = words(a), bb = words(b);
  if (!aa.size || !bb.size) return 0;
  const intersection = [...aa].filter(w => bb.has(w)).length;
  return intersection / new Set([...aa, ...bb]).size;
}

function matchScore(source: any, candidate: any) {
  const visual = Math.max(0, cosine(source.imageEmbedding || [], candidate.imageEmbedding || []));
  const text = tokenSimilarity(`${source.title} ${source.description} ${source.category}`, `${candidate.title} ${candidate.description} ${candidate.category}`);
  const location = source.location.toLowerCase() === candidate.location.toLowerCase() ? 1 : (source.location.toLowerCase().includes(candidate.location.toLowerCase()) || candidate.location.toLowerCase().includes(source.location.toLowerCase()) ? 0.6 : 0);
  const days = Math.abs(new Date(source.reportedAt).getTime() - new Date(candidate.reportedAt).getTime()) / 86400000;
  const recency = Math.max(0, 1 - days / 30);
  const visualWeight = source.imageEmbedding?.length && candidate.imageEmbedding?.length ? 0.55 : 0;
  const remaining = 1 - visualWeight;
  return Math.round((visual * visualWeight + text * 0.25 * remaining + location * 0.45 * remaining + recency * 0.30 * remaining) * 100);
}

function serialize(item: any, score = 0) {
  return {
    id: item.id, title: item.title, name: item.title, description: item.description,
    category: item.category, location: item.location, place: item.location,
    status: item.status, match: score || item.matchScore || 0,
    image: item.imageUrl ? `http://localhost:${process.env.PORT || 5000}${item.imageUrl}` : '',
    imageUrl: item.imageUrl, date: new Date(item.reportedAt || item.createdAt).toLocaleString(),
    createdAt: item.createdAt, owner: item.owner
  };
}

router.get('/', optionalAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status, q } = req.query;
    const filter: any = {};
    if (status && ['Lost', 'Found', 'Claimed', 'Resolved'].includes(String(status))) filter.status = status;
    if (q) filter.$text = { $search: String(q) };
    const docs = await Item.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ items: docs.map(doc => serialize(doc)) });
  } catch (error) { next(error); }
});

router.post('/', optionalAuth, upload.single('image'), async (req: AuthRequest, res, next) => {
  try {
    const { title, name, description, category, location, place, status, contact } = req.body ?? {};
    const itemTitle = title || name;
    const itemLocation = location || place;
    if (!itemTitle || !itemLocation || !['Lost', 'Found'].includes(status)) return res.status(400).json({ message: 'Title, location and Lost/Found status are required' });
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';
    const imageEmbedding = await createImageEmbedding(req.file?.path);
    const item = await Item.create({
      title: itemTitle, description: description || '', category: category || 'Personal items',
      location: itemLocation, status, imageUrl, imageEmbedding, contact: contact || '', owner: req.user?.id || null
    });
    // Notify the reporter and create contextual candidates for later review.
    if (req.user?.id) await Notification.create({ user: req.user.id, title: `${status} report submitted`, message: `Your report for "${item.title}" is now visible to the campus community.`, type: 'system', relatedItem: item.id });
    // Find opposite-status reports and notify their signed-in reporters about candidate matches.
    const opposite = status === 'Lost' ? 'Found' : 'Lost';
    const candidates = await Item.find({ status: opposite, _id: { $ne: item.id } }).limit(100);
    const ranked = candidates.map(candidate => ({ candidate, score: matchScore(item, candidate) })).filter(row => row.score >= 25).sort((a,b) => b.score-a.score).slice(0,5);
    for (const row of ranked) {
      if (row.candidate.owner) await Notification.create({ user: row.candidate.owner, title: 'Possible lost-and-found match', message: `A new report "${item.title}" may match "${row.candidate.title}" (${row.score}% contextual score).`, type: 'match', relatedItem: item.id });
      if (item.owner) await Notification.create({ user: item.owner, title: 'Possible item match found', message: `"${row.candidate.title}" may match your report (${row.score}% contextual score).`, type: 'match', relatedItem: row.candidate.id });
    }
    res.status(201).json({ item: serialize(item, ranked[0]?.score || 0), matches: ranked.map(row => serialize(row.candidate, row.score)) });
  } catch (error) { next(error); }
});

router.get('/:id/matches', async (req, res, next) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    const opposite = item.status === 'Lost' ? 'Found' : 'Lost';
    const candidates = await Item.find({ status: opposite, _id: { $ne: item.id } }).limit(100);
    const matches = candidates.map(candidate => ({ candidate, score: matchScore(item, candidate) }))
      .sort((a,b) => b.score-a.score).slice(0,10)
      .map(row => ({ ...serialize(row.candidate, row.score), scoreBreakdown: {
        visual: item.imageEmbedding?.length && row.candidate.imageEmbedding?.length ? Math.round(Math.max(0, cosine(item.imageEmbedding, row.candidate.imageEmbedding))*100) : null,
        text: Math.round(tokenSimilarity(`${item.title} ${item.description} ${item.category}`, `${row.candidate.title} ${row.candidate.description} ${row.candidate.category}`)*100),
        location: item.location.toLowerCase() === row.candidate.location.toLowerCase() ? 100 : 0
      }}));
    res.json({ matches, aiMode: matches.some(m => m.scoreBreakdown.visual !== null) ? 'CLIP + context' : 'Context-only fallback' });
  } catch (error) { next(error); }
});


router.post('/:id/claim', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.status !== 'Found') return res.status(400).json({ message: 'Only found items can receive claim requests' });
    if (item.owner?.toString() === req.user?.id) return res.status(400).json({ message: 'You cannot claim your own report' });
    if (item.owner) await Notification.create({
      user: item.owner, title: 'New item claim request',
      message: `${req.user?.name || 'A student'} believes "${item.title}" belongs to them. Please verify ownership before handover.`,
      type: 'match', relatedItem: item.id
    });
    res.status(201).json({ message: 'Claim request sent. The reporter will be notified for verification.' });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ item: serialize(item) });
  } catch (error) { next(error); }
});

router.patch('/:id/status', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body ?? {};
    if (!['Claimed', 'Resolved'].includes(status)) return res.status(400).json({ message: 'Status must be Claimed or Resolved' });
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.owner && item.owner.toString() !== req.user?.id && req.user?.role !== 'admin') return res.status(403).json({ message: 'Only the reporter or an admin can update this item' });
    item.status = status;
    await item.save();
    res.json({ item: serialize(item) });
  } catch (error) { next(error); }
});

export default router;