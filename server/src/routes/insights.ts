import { Router } from 'express';
import { isDbConnected, wasDatabaseConnected } from '../config/db.js';
import { store } from '../config/store.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    if (wasDatabaseConnected() && !isDbConnected()) {
      return res.status(503).json({
        message: 'Database connection is currently unavailable. Unable to load campus insights.',
      });
    }

    const insights = await store.getInsights();
    return res.json({ insights });
  } catch (error: any) {
    if (
      error?.name === 'MongooseError' ||
      error?.name === 'MongoNetworkError' ||
      String(error?.message || '').includes('buffering timed out')
    ) {
      return res.status(503).json({
        message: 'Database connection is currently unavailable. Unable to load campus insights.',
      });
    }
    console.error('Failed to compute campus insights:', error);
    return res.status(500).json({ message: 'An unexpected server error occurred' });
  }
});

export default router;
