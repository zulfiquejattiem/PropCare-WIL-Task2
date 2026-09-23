const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { repositories } = require('../repositories');

const router = express.Router();

router.use(authenticate);

// GET /api/technicians - managers and admins only
router.get('/', authorize('manager', 'admin'), (req, res) => {
  const technicians = repositories.technicians.listAll().map((t) => ({
    id: t.id,
    userId: t.user_id,
    name: t.name,
    email: t.email,
    skill: t.skill,
  }));
  res.status(200).json({ status: 'success', data: { technicians } });
});

module.exports = router;
