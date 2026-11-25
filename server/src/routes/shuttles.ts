import { Router } from 'express';
import { store } from '../config/store.js';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const shuttles = await store.listShuttles(true);
    res.json({ shuttles });
  } catch (error) { next(error); }
});

router.post('/', requireAuth, requireRole('driver', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const { code, routeName, origin, destination, stops } = req.body ?? {};
    const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const cleanName = typeof routeName === 'string' ? routeName.trim() : '';
    const cleanOrigin = typeof origin === 'string' ? origin.trim() : '';
    const cleanDestination = typeof destination === 'string' ? destination.trim() : '';
    if (!/^[A-Z0-9_-]{1,16}$/.test(cleanCode)) {
      return res.status(400).json({ message: 'Route code must be 1–16 letters, numbers, hyphens, or underscores' });
    }
    if (!cleanName || !cleanOrigin || !cleanDestination) {
      return res.status(400).json({ message: 'Route name, origin, and destination are required' });
    }
    const parsedStops = Array.isArray(stops)
      ? stops.map(s => String(s).trim()).filter(Boolean)
      : typeof stops === 'string'
        ? stops.split(',').map(s => s.trim()).filter(Boolean)
        : [cleanOrigin, cleanDestination];
    const finalStops = parsedStops.length > 0 ? parsedStops : [cleanOrigin, cleanDestination];

    const shuttle = await store.createShuttleRoute({
      code: cleanCode,
      routeName: cleanName,
      origin: cleanOrigin,
      destination: cleanDestination,
      stops: finalStops,
    });
    const io = req.app.get('io');
    io?.emit('shuttle:created', shuttle);
    io?.emit('shuttle:summary', {
      code: shuttle.code,
      hasGps: false,
      lastGpsAt: undefined,
    });
    res.status(201).json({ shuttle });
  } catch (error: any) {
    if (error?.statusCode === 409 || error?.code === 11000) {
      return res.status(409).json({ message: error.message || 'Shuttle route code already exists' });
    }
    next(error);
  }
});

router.post('/:code/location', requireAuth, requireRole('driver', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const { latitude, longitude, heading, speedKmph, timestamp } = req.body ?? {};
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    }
    const cleanHeading = typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : undefined;
    const cleanSpeed = typeof speedKmph === 'number' && Number.isFinite(speedKmph) && speedKmph >= 0 ? speedKmph : undefined;

    let gpsDate = new Date();
    if (timestamp !== undefined && timestamp !== null && timestamp !== '') {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'Invalid GPS timestamp' });
      }
      gpsDate = parsed;
    }

    const shuttle = await store.updateShuttleLocation(String(req.params.code), {
      latitude,
      longitude,
      heading: cleanHeading,
      speedKmph: cleanSpeed,
      lastGpsAt: gpsDate,
      driver: req.user?.id,
    });
    if (!shuttle) return res.status(404).json({ message: 'Active shuttle route not found' });

    const io = req.app.get('io');
    io?.to(`shuttle:${shuttle.code}`).emit('shuttle:location', shuttle);
    io?.emit('shuttle:summary', {
      code: shuttle.code,
      hasGps: true,
      lastGpsAt: shuttle.lastGpsAt,
    });
    res.json({ shuttle });
  } catch (error) { next(error); }
});

router.post('/:code/stop', requireAuth, requireRole('driver', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const shuttle = await store.stopShuttleLocation(String(req.params.code));
    if (!shuttle) return res.status(404).json({ message: 'Active shuttle route not found' });

    const io = req.app.get('io');
    io?.to(`shuttle:${shuttle.code}`).emit('shuttle:stopped', shuttle);
    io?.emit('shuttle:summary', {
      code: shuttle.code,
      hasGps: false,
      lastGpsAt: undefined,
    });
    res.json({ shuttle });
  } catch (error) { next(error); }
});

export default router;