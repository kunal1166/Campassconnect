import { Router } from 'express';
import { store } from '../config/store.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const notifications = req.user?.id ? await store.listNotificationsByUser(req.user.id) : [];
    res.json({ notifications });
  } catch (error) { next(error); }
});

router.patch('/read-all', async (req: AuthRequest, res, next) => {
  try {
    if (req.user?.id) await store.markAllNotificationsRead(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) { next(error); }
});

router.patch('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    const notification = req.user?.id ? await store.markNotificationRead(String(req.params.id), req.user.id) : null;
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json({ notification });
  } catch (error) { next(error); }
});
export default router;