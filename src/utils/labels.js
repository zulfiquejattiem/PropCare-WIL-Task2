/**
 * Shared display labels.
 *
 * Kept in one module so the API, the notifications and the front end can never
 * drift apart when a status or role is renamed.
 */
const { STATUSES, URGENCIES, OPEN_STATUSES, RESOLVED_STATUSES } = require('../db');

const STATUS_LABELS = STATUSES.reduce((acc, s) => {
  acc[s.id] = s.name;
  return acc;
}, {});

const URGENCY_LABELS = URGENCIES.reduce((acc, u) => {
  acc[u.id] = u.name;
  return acc;
}, {});

const ROLE_LABELS = {
  tenant: 'Tenant',
  manager: 'Property Manager',
  technician: 'Technician',
  admin: 'Administrator',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function urgencyLabel(urgency) {
  return URGENCY_LABELS[urgency] || urgency;
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

module.exports = {
  STATUSES,
  URGENCIES,
  OPEN_STATUSES,
  RESOLVED_STATUSES,
  STATUS_LABELS,
  URGENCY_LABELS,
  ROLE_LABELS,
  statusLabel,
  urgencyLabel,
  roleLabel,
};
