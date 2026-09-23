const express = require('express');
const { authenticate } = require('../middleware/auth');
const { repositories } = require('../repositories');
const { resolveActor } = require('../services/requests');
const { URGENCIES, STATUSES, OPEN_STATUSES } = require('../utils/labels');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/categories
 * Counts are scoped to what the caller may see, exactly like /api/requests -
 * a tenant must not be able to infer portfolio-wide volumes from a lookup call.
 */
router.get('/categories', (req, res) => {
  const counts = repositories.requests.countByCategory(resolveActor(req.user));
  const categories = repositories.reference.categories().map((c) => ({
    id: c.id,
    name: c.name,
    count: (counts.find((x) => x.id === c.id) || {}).n || 0,
  }));
  res.status(200).json({ status: 'success', data: { categories } });
});

// GET /api/categories/:id - with the caller's scoped request count
router.get('/categories/:id', (req, res, next) => {
  const cat = repositories.reference.findCategory(req.params.id);
  if (!cat) {
    return next(new AppError('Category not found', 404));
  }
  const n = repositories.requests
    .countByCategory(resolveActor(req.user))
    .find((c) => c.id === cat.id)?.n || 0;
  res.status(200).json({ status: 'success', data: { category: { ...cat, count: n } } });
});

// GET /api/statuses
router.get('/statuses', (req, res) => {
  res.status(200).json({ status: 'success', data: { statuses: STATUSES, openStatuses: OPEN_STATUSES } });
});

// GET /api/urgencies
router.get('/urgencies', (req, res) => {
  res.status(200).json({ status: 'success', data: { urgencies: URGENCIES } });
});

module.exports = router;
