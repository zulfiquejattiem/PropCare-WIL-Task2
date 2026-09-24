const express = require('express');
const { authenticate } = require('../middleware/auth');
const { repositories } = require('../repositories');
const { resolveActor } = require('../services/requests');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(authenticate);

/**
 * Build the report summary for a caller.
 *
 * All aggregation is pushed into SQL (see RequestRepository.totals /
 * countByStatus / countByCategory) rather than loading every row into memory
 * and reducing it in JavaScript.
 */
function buildSummary(user) {
  const actor = resolveActor(user);
  const totals = repositories.requests.totals(actor);

  const byCategory = repositories.requests
    .countByCategory(actor)
    .map((c) => ({ name: c.name, count: c.n }))
    .sort((a, b) => b.count - a.count);

  const byStatus = repositories.requests
    .countByStatus(actor)
    .map((s) => ({ status: s.status, count: s.n }))
    .sort((a, b) => b.count - a.count);

  const scope = actor.role === 'manager' ? { managerId: actor.id } : {};
  // One query. Managers reuse these same rows for `portfolio`, so the summary
  // endpoint no longer issues two identical queries per request.
  const propertyRows = repositories.properties.requestCounts({ ...scope, openOnly: true });

  const byProperty = propertyRows
    .filter((p) => p.n > 0)
    .map((p) => ({ id: p.id, name: p.name, count: p.n }))
    .sort((a, b) => b.count - a.count);

  return {
    total: totals.total,
    open: totals.open,
    resolved: totals.resolved,
    byCategory,
    byStatus,
    byProperty,
    _propertyRows: propertyRows,
  };
}

/**
 * GET /api/reports/summary
 * Manager: stats scoped to their portfolio. Admin: platform-wide stats.
 */
router.get('/summary', (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const summary = buildSummary(req.user);
      delete summary._propertyRows;

      summary.users = {
        tenants: repositories.users.countByRole('tenant'),
        managers: repositories.users.countByRole('manager'),
        technicians: repositories.users.countByRole('technician'),
        admins: repositories.users.countByRole('admin'),
      };
      summary.properties = repositories.properties.countAll();
      summary.units = repositories.properties.countUnits();

      return res.status(200).json({ status: 'success', data: { summary } });
    }

    if (req.user.role === 'manager') {
      const summary = buildSummary(req.user);
      const propertyRows = summary._propertyRows;
      delete summary._propertyRows;

      // `properties` is a scalar on the admin payload, so the per-property
      // breakdown for managers lives under its own, clearly named key.
      // Unlike `byProperty` this keeps zero-count properties, so a manager sees
      // their whole portfolio including buildings with nothing open.
      summary.portfolio = propertyRows.map((p) => ({ id: p.id, name: p.name, count: p.n }));

      return res.status(200).json({ status: 'success', data: { summary } });
    }

    return next(new AppError('Only managers and administrators can view reports.', 403));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
