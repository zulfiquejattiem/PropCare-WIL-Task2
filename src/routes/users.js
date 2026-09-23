const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticate, authorize } = require('../middleware/auth');
const { registerUserValidation, updateProfileValidation } = require('../middleware/validate');
const { repositories } = require('../repositories');
const { eventBus } = require('../observers/event-bus');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

router.use(authenticate);

// GET /api/users - admin only
router.get('/', authorize('admin'), (req, res) => {
  const users = repositories.users.list().map((u) => ({ ...u, active: Boolean(u.active) }));
  res.status(200).json({ status: 'success', data: { users } });
});

/**
 * POST /api/users - admin creates a new account.
 *
 * The account is made *usable* immediately:
 *   - technicians also get a `technicians` trade record, so they appear in the
 *     manager's assignment list and can see their own jobs;
 *   - tenants can optionally be attached to a property unit, which is what
 *     authorises them to raise a request.
 */
router.post('/', authorize('admin'), registerUserValidation, async (req, res, next) => {
  try {
    const { name, email, password, role, skill, propertyId, unit } = req.body;

    if (repositories.users.findByEmail(email)) {
      return next(new AppError('A user with this email already exists', 409));
    }

    // A tenant needs a unit before they can raise a request.
    if (role === 'tenant' && (!propertyId || !unit)) {
      return next(new AppError('A tenant must be assigned to a property and unit.', 400));
    }
    if ((propertyId || unit) && !repositories.properties.findById(propertyId)) {
      return next(new AppError('Property not found', 404));
    }

    const id = repositories.users.nextId();
    const hash = await bcrypt.hash(password, 10);

    repositories.users.transaction(() => {
      repositories.users.insert({ id, name, email, passwordHash: hash, role });

      if (role === 'technician') {
        repositories.users.createTechnician({
          id: repositories.users.nextTechnicianId(),
          userId: id,
          skill: skill || 'General maintenance',
        });
      }

      if (role === 'tenant' && propertyId && unit) {
        repositories.users.assignUnit(id, propertyId, unit);
      }
    });

    eventBus.emit('user.created', {
      type: 'user.created',
      at: new Date().toISOString(),
      actor: req.user,
      userId: id,
      role,
    });

    logger.info('User created by admin', { id, email, role });
    res.status(201).json({
      status: 'success',
      message: 'User created',
      data: {
        user: {
          id,
          name,
          email: String(email).toLowerCase(),
          role,
          active: true,
          units: repositories.users.unitsFor(id).map((u) => u.name),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me - own profile (with units)
router.get('/me', (req, res, next) => {
  const row = repositories.users.findById(req.user.id);
  if (!row) {
    return next(new AppError('User not found', 404));
  }
  const units = repositories.users.unitsFor(req.user.id).map((u) => ({
    name: u.name,
    propertyId: u.property_id,
    propertyName: u.property_name,
  }));
  res.status(200).json({
    status: 'success',
    data: { user: { ...row, active: Boolean(row.active), units } },
  });
});

// PUT /api/users/me - update own profile
router.put('/me', updateProfileValidation, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const current = repositories.users.findByIdFull(req.user.id);

    if (email) {
      const taken = repositories.users.findByEmail(email);
      if (taken && taken.id !== req.user.id) {
        return next(new AppError('A user with this email already exists', 409));
      }
    }

    const newName = name || current.name;
    const newEmail = (email || current.email).toLowerCase();
    const hash = password ? await bcrypt.hash(password, 10) : current.password_hash;

    repositories.users.updateProfile(req.user.id, { name: newName, email: newEmail, passwordHash: hash });

    eventBus.emit('user.updated_profile', {
      type: 'user.updated_profile',
      at: new Date().toISOString(),
      actor: req.user,
      userId: req.user.id,
    });

    logger.info('User updated profile', { id: req.user.id });
    res.status(200).json({
      status: 'success',
      message: 'Profile updated',
      data: {
        user: {
          id: req.user.id,
          name: newName,
          email: newEmail,
          role: current.role,
          active: Boolean(current.active),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id/status - admin activates / deactivates an account
router.put('/:id/status', authorize('admin'), (req, res, next) => {
  const active = req.body.active;
  if (typeof active !== 'boolean') {
    return next(new AppError('active must be a boolean', 400));
  }
  const row = repositories.users.findByIdFull(req.params.id);
  if (!row) {
    return next(new AppError('User not found', 404));
  }
  if (row.id === req.user.id) {
    return next(new AppError('You cannot deactivate your own account', 400));
  }

  repositories.users.setActive(req.params.id, active);

  eventBus.emit('user.status_changed', {
    type: 'user.status_changed',
    at: new Date().toISOString(),
    actor: req.user,
    userId: row.id,
    active,
  });

  logger.info('User status changed', { id: req.params.id, active });
  res.status(200).json({ status: 'success', message: active ? 'User activated' : 'User deactivated' });
});

module.exports = router;
