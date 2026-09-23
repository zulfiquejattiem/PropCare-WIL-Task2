const express = require('express');
const { authenticate } = require('../middleware/auth');
const { repositories } = require('../repositories');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(authenticate);

/**
 * Role-scoped property list. Every role sees only what it is entitled to:
 *   admin      -> the whole portfolio
 *   manager    -> their own managed properties
 *   tenant     -> properties they have raised a request against
 *   technician -> properties their assigned jobs sit in
 */
router.get('/', (req, res, next) => {
  try {
    let rows = [];

    if (req.user.role === 'admin') {
      rows = repositories.properties.listAll();
    } else if (req.user.role === 'manager') {
      rows = repositories.properties.forManager(req.user.id);
    } else if (req.user.role === 'tenant') {
      rows = repositories.properties.forTenant(req.user.id);
    } else if (req.user.role === 'technician') {
      // users.id is U9/U10/... while requests.tech_id is T1/T2/...
      // Resolve the technician record before querying assigned properties.
      const technician = repositories.technicians.findByUserId(req.user.id);
      rows = technician ? repositories.properties.forTechnician(technician.id) : [];
    }

    const properties = rows.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      area: p.area,
      managerId: p.manager_id,
      managerName: p.manager_name,
    }));

    res.status(200).json({ status: 'success', data: { properties } });
  } catch (err) {
    next(err);
  }
});

// GET /api/properties/:id
router.get('/:id', (req, res, next) => {
  try {
    const prop = repositories.properties.findById(req.params.id);

    if (!prop) {
      return next(new AppError('Property not found', 404));
    }

    // Managers may only view properties they manage.
    if (req.user.role === 'manager' && prop.manager_id !== req.user.id) {
      return next(new AppError('You do not have permission to view this property', 403));
    }

    // Tenants and technicians only receive the scoped property list.
    // Do not allow arbitrary property-detail enumeration.
    if (req.user.role === 'tenant' || req.user.role === 'technician') {
      return next(new AppError('You do not have permission to view this property', 403));
    }

    res.status(200).json({
      status: 'success',
      data: {
        property: {
          id: prop.id,
          name: prop.name,
          address: prop.address,
          area: prop.area,
          managerId: prop.manager_id,
          managerName: prop.manager_name,
          // Open requests only - resolved and cancelled work is not "open".
          openRequests: repositories.properties.openCountFor(prop.id),
          totalRequests: repositories.properties
            .requestCounts({})
            .find((p) => p.id === prop.id)?.n || 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
