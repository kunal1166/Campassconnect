
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

const router = Router();

const getJwtSecret = () => {
  return process.env.JWT_SECRET || 'dev_only_change_me';
};

function createToken(user: any) {
  return jwt.sign(
    {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

function publicUser(user: any) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role
  };
}

// REGISTER
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body ?? {};

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, email and password are required'
      });
    }

    if (String(name).trim().length < 2) {
      return res.status(400).json({
        message: 'Name must contain at least 2 characters'
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const validRole = role === 'driver' ? 'driver' : 'student';

    const existingUser = await User.findOne({
      email: normalizedEmail
    });

    if (existingUser) {
      return res.status(409).json({
        message: 'An account with this email already exists'
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      role: validRole
    });

    const token = createToken(user);

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: publicUser(user)
    });

  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: 'An account with this email already exists'
      });
    }
    next(error);
  }
});

// LOGIN
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail
    });

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    const passwordMatch = await bcrypt.compare(
      String(password),
      user.passwordHash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    const token = createToken(user);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: publicUser(user)
    });

  } catch (error) {
    next(error);
  }
});

// GET CURRENT USER
router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await User.findById(req.user?.id);

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    return res.json({
      user: publicUser(user)
    });

  } catch (error) {
    next(error);
  }
});

export default router;
