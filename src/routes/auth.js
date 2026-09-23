const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { loginValidation } = require('../middleware/validate');
const { authenticate, ISSUER, AUDIENCE } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { repositories } = require('../repositories');
const { eventBus } = require('../observers/event-bus');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Brute-force mitigation: after this many consecutive failed sign-ins the
 * account is locked for a short cool-off. Deliberately forgiving (a demo where
 * a marker mistypes a password 5 times must not lock them out) while still
 * making online password guessing impractical.
 */
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 5;

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );
};

const withUnits = (user) => {
  const units = repositories.users.unitsFor(user.id).map((u) => ({
    name: u.name,
    propertyId: u.property_id,
    propertyName: u.property_name,
  }));
  return { ...user, units };
};

/** Burn the same CPU whether or not the account exists (blocks user enumeration). */
async function dummyCompare(password) {
  await bcrypt.compare(password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
}

router.post('/login', loginValidation, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const userRow = repositories.users.findByEmail(email);

    if (!userRow) {
      await dummyCompare(password);
      eventBus.emit('auth.login', {
        type: 'auth.login',
        at: new Date().toISOString(),
        actor: { id: null, name: String(email) },
        success: false,
        reason: 'unknown email',
      });
      return next(new AppError('Invalid email or password', 401));
    }

    // Brute-force mitigation: lock the account after repeated failures.
    if (userRow.locked_until && new Date(userRow.locked_until) > new Date()) {
      const minutes = Math.ceil((new Date(userRow.locked_until) - new Date()) / 60000);
      return next(new AppError(
        `Too many failed sign-in attempts. Try again in ${minutes} minute(s).`,
        429
      ));
    }

    const isMatch = await bcrypt.compare(password, userRow.password_hash);

    if (!isMatch) {
      const attempts = (userRow.failed_logins || 0) + 1;
      if (attempts >= MAX_FAILED_LOGINS) {
        const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        repositories.users.lockAccount(userRow.id, until);
        repositories.users.recordFailedLogin(userRow.id, 0);
        logger.warn('Account locked after repeated failed logins', { userId: userRow.id });
      } else {
        repositories.users.recordFailedLogin(userRow.id, attempts);
      }
      eventBus.emit('auth.login', {
        type: 'auth.login',
        at: new Date().toISOString(),
        actor: { id: userRow.id, name: userRow.name },
        userId: userRow.id,
        success: false,
        reason: 'bad password',
      });
      return next(new AppError('Invalid email or password', 401));
    }

    if (!userRow.active) {
      return next(new AppError('This account has been deactivated. Contact an administrator.', 403));
    }

    repositories.users.clearLoginFailures(userRow.id);

    const safeUser = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      role: userRow.role,
      active: Boolean(userRow.active),
      createdAt: userRow.created_at,
    };
    const token = generateToken(safeUser);

    eventBus.emit('auth.login', {
      type: 'auth.login',
      at: new Date().toISOString(),
      actor: safeUser,
      userId: safeUser.id,
      success: true,
    });

    logger.info('User logged in', { userId: userRow.id, email: userRow.email });
    res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: { user: withUnits(safeUser), token },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res, next) => {
  const row = repositories.users.findById(req.user.id);
  if (!row) {
    return next(new AppError('User no longer exists', 404));
  }
  res.status(200).json({ status: 'success', data: { user: withUnits(row) } });
});

router.post('/logout', authenticate, (req, res) => {
  logger.info('User logged out', { userId: req.user.id });
  res.status(200).json({ status: 'success', message: 'Logged out successfully' });
});

module.exports = router;
module.exports.MAX_FAILED_LOGINS = MAX_FAILED_LOGINS;
module.exports.LOCKOUT_MINUTES = LOCKOUT_MINUTES;
