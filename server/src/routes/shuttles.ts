import { Router } from 'express';
import { Shuttle } from '../models/Shuttle.js';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const shuttles = await Shuttle.find({ active: true }).sort({ code: 1 });
    res.json({ shuttles });
  } catch (error) { next(error); }
});

router.post('/seed-demo', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const demo = [
      { code: 'R1', routeName: 'Main Gate – Academic Block', origin: 'Main Gate', destination: 'Academic Block', stops: ['Main Gate', 'Library', 'Academic Block'] },
      { code: 'R2', routeName: 'Hostel – Cafeteria', origin: 'Hostel', destination: 'Cafeteria', stops: ['Hostel', 'Main Gate', 'Cafeteria'] },
      { code: 'R3', routeName: 'Library – Auditorium', origin: 'Library', destination: 'Auditorium', stops: ['Library', 'Academic Block', 'Auditorium'] }
    ];
    for (const route of demo) await Shuttle.updateOne({ code: route.code }, { $setOnInsert: route }, { upsert: true });
    res.json({ message: 'Demo routes ensured', shuttles: await Shuttle.find().sort({ code: 1 }) });
  } catch (error) { next(error); }
});

router.post('/:code/location', requireAuth, requireRole('driver', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const { latitude, longitude, heading, speedKmph } = req.body ?? {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    const shuttle = await Shuttle.findOneAndUpdate({ code: req.params.code.toUpperCase(), active: true }, {
      latitude, longitude, heading, speedKmph, lastGpsAt: new Date(), driver: req.user?.id
    }, { new: true });
    if (!shuttle) return res.status(404).json({ message: 'Active shuttle route not found' });
    req.app.get('io')?.emit('shuttle:location', shuttle);
    res.json({ shuttle });
  } catch (error) { next(error); }
});

export default router;