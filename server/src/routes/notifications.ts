import { Router } from 'express';
import { Notification } from '../models/Notification.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user?.id }).sort({ createdAt: -1 }).limit(50);
    res.json({ notifications });
  } catch (error) { next(error); }
});

router.patch('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user?.id }, { read: true }, { new: true });
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json({ notification });
  } catch (error) { next(error); }
});

router.patch('/read-all', async (req: AuthRequest, res, next) => {
  try {
    await Notification.updateMany({ user: req.user?.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) { next(error); }
});
export default router;