const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { repositories } = require('../repositories');
const { OPEN_STATUSES } = require('../utils/labels');

const router = express.Router();

router.use(authenticate);

// GET /api/tenants - managers and admins can view tenants
router.get('/', authorize('manager', 'admin'), (req, res) => {
  const tenants = repositories.users
    .listByRole('tenant')
    .map((u) => {
      const units = repositories.users.unitsFor(u.id).map((x) => x.name);
      const open = repositories.requests
        .forTenant(u.id)
        .filter((r) => OPEN_STATUSES.includes(r.status)).length;
      return { id: u.id, name: u.name, email: u.email, units, openRequests: open };
    });
  res.status(200).json({ status: 'success', data: { tenants } });
});

module.exports = router;
