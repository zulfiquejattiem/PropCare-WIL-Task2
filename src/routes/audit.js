const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { repositories } = require('../repositories');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/audit-log - administrator-only view of the security trail
 * written by the AuditLogObserver.
 */
router.get('/', authorize('admin'), (req, res) => {
  const entries = repositories.audit.recent(req.query.limit);
  res.status(200).json({ status: 'success', data: { entries } });
});

module.exports = router;
