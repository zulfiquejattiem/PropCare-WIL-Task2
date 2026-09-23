/**
 * RequestService - the maintenance-request business rules.
 *
 * The service owns the workflow (who may do what, and what it means), owns no
 * SQL (that is the repositories), and owns no side effects (those are the
 * observers). It publishes domain events on the bus and returns the refreshed
 * aggregate.
 */
const { repositories } = require('../repositories');
const { eventBus } = require('../observers/event-bus');
const { AppError } = require('../middleware/errorHandler');
const { OPEN_STATUSES, statusLabel, roleLabel } = require('../utils/labels');
const logger = require('../utils/logger');

function nowStamp() {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

/**
 * Attach the technician record id to the caller, once per request.
 * Users are `U<id>` while jobs are assigned to `T<id>`, so every technician
 * authorisation check has to resolve that mapping first.
 */
function resolveActor(user) {
  if (user.technicianId !== undefined) return user;
  const technician = user.role === 'technician'
    ? repositories.technicians.findByUserId(user.id)
    : null;
  return { ...user, technicianId: technician ? technician.id : null };
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

function listForUser(user) {
  const actor = resolveActor(user);
  if (actor.role === 'admin') return repositories.requests.listAll();
  if (actor.role === 'tenant') return repositories.requests.forTenant(actor.id);
  if (actor.role === 'technician') {
    return actor.technicianId ? repositories.requests.forTechnician(actor.technicianId) : [];
  }
  return repositories.requests.forManager(actor.id);
}

function rowToDetail(row) {
  if (!row) return null;
  return {
    id: row.id,
    propertyId: row.property_id,
    propertyName: row.property_name,
    unit: row.unit,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    category: row.category,
    categoryName: row.category_name,
    title: row.title,
    detail: row.detail,
    urgency: row.urgency,
    status: row.status,
    techId: row.tech_id,
    technicianId: row.tech_id,
    technicianName: row.technician_name,
    technicianSkill: row.technician_skill,
    created: row.created,
    updated: row.updated,
    photos: row.photos,
  };
}

function listToDetail(rows) {
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    propertyName: r.property_name,
    unit: r.unit,
    category: r.category,
    categoryName: r.category_name,
    title: r.title,
    detail: r.detail,
    urgency: r.urgency,
    status: r.status,
    techId: r.tech_id,
    created: r.created,
    updated: r.updated,
    photos: r.photos,
  }));
}

/* ------------------------------------------------------------------ */
/* Authorisation                                                       */
/* ------------------------------------------------------------------ */

/** Object-level authorisation: may this user see this request? */
function canView(user, row) {
  const actor = resolveActor(user);
  if (actor.role === 'admin') return true;
  if (actor.role === 'tenant') return row.tenant_id === actor.id;
  if (actor.role === 'technician') {
    return !!actor.technicianId && row.tech_id === actor.technicianId;
  }
  // manager - owns the property the request belongs to
  const prop = repositories.properties.findById(row.property_id);
  return !!prop && prop.manager_id === actor.id;
}

/** Manager responsible for the property a request belongs to (for notifications). */
function managerFor(row) {
  const prop = repositories.properties.findById(row.property_id);
  return prop ? prop.manager_id : null;
}

/**
 * Normalise a raw request row into the shape the observers expect.
 * Database columns are snake_case; domain events speak camelCase, and mixing
 * the two silently drops notifications.
 */
function eventRequest(row) {
  return {
    id: row.id,
    title: row.title,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    unit: row.unit,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    techId: row.tech_id,
  };
}

function technicianUserIdFor(row) {
  if (!row.tech_id) return null;
  const technician = repositories.technicians.findById(row.tech_id);
  return technician ? technician.user_id : null;
}

function getDetail(user, id) {
  const row = repositories.requests.findById(id);
  if (!row) {
    throw new AppError(`Request ${id} not found`, 404);
  }
  if (!canView(user, row)) {
    throw new AppError('You do not have permission to view this request.', 403);
  }
  const detail = rowToDetail(row);
  detail.comments = repositories.requests.commentsFor(id).map((c) => ({
    by: c.name,
    role: c.role_label,
    when: c.created_at,
    text: c.text,
  }));
  detail.history = repositories.requests.historyFor(id).map((h) => ({
    status: h.status,
    when: h.created_at,
  }));
  const rating = repositories.requests.ratingFor(id);
  detail.rating = rating ? rating.stars : null;
  return detail;
}

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

/**
 * Valid status transitions per role, keyed by the request's current status.
 * `rate` is deliberately absent: rating is its own endpoint, not a status.
 */
const TRANSITIONS = {
  tenant: {
    submitted: ['cancel'],
    'under-review': ['cancel'],
    completed: ['confirm', 'reopen'],
  },
  manager: {
    submitted: ['assign', 'approve'],
    'under-review': ['assign', 'approve'],
    completed: ['approve'],
  },
  technician: {
    assigned: ['accept', 'reject'],
    'in-progress': ['hold', 'complete'],
    'on-hold': ['resume'],
  },
  admin: {
    submitted: ['cancel', 'approve'],
    'under-review': ['approve'],
  },
};

function allowedActions(user, row) {
  const perRole = TRANSITIONS[user.role] || {};
  return perRole[row.status] || [];
}

function canPerform(user, row, action) {
  if (action === 'assign') {
    return user.role === 'manager' && ['submitted', 'under-review'].includes(row.status);
  }
  if (action === 'rate') return user.role === 'tenant' && row.status === 'completed';
  return allowedActions(user, row).includes(action);
}

const ACTION_NOTE = {
  cancel: 'Request cancelled.',
  confirm: 'Work confirmed and request closed.',
  reopen: 'Request reopened - work not fully resolved.',
  approve: 'Approved and closed by property manager.',
  accept: 'Job accepted by technician.',
  reject: 'Job rejected by technician.',
  hold: 'Placed on hold (awaiting parts or access).',
  resume: 'Work resumed.',
  complete: 'Work marked complete - awaiting tenant confirmation.',
};

const NEXT_STATUS = {
  cancel: 'cancelled',
  confirm: 'closed',
  approve: 'closed',
  accept: 'in-progress',
  reject: 'rejected',
  hold: 'on-hold',
  resume: 'in-progress',
  complete: 'completed',
  reopen: 'in-progress',
};

function applyStatusAction(user, id, action, text) {
  const row = repositories.requests.findById(id);
  if (!row) {
    throw new AppError(`Request ${id} not found`, 404);
  }
  if (!canView(user, row)) {
    throw new AppError('You do not have permission to update this request.', 403);
  }
  if (!canPerform(user, row, action)) {
    throw new AppError(`Action "${action}" is not allowed for ${user.role} on a ${row.status} request.`, 400);
  }

  const nextStatus = NEXT_STATUS[action];
  const when = nowStamp();
  const note = text || ACTION_NOTE[action] || 'Status updated.';

  repositories.requests.transaction(() => {
    // `updated` keeps the full timestamp so ordering within a day is stable.
    repositories.requests.updateStatus(id, nextStatus, when);
    repositories.requests.addHistory({ requestId: id, status: statusLabel(nextStatus), createdAt: when });
    repositories.requests.addComment({
      requestId: id,
      userId: user.id,
      name: user.name,
      roleLabel: roleLabel(user.role),
      text: note,
      createdAt: when,
    });
  });

  eventBus.emit('request.status_changed', {
    type: 'request.status_changed',
    at: when,
    actor: user,
    action,
    nextStatus,
    request: eventRequest(row),
    managerId: managerFor(row),
    technicianUserId: technicianUserIdFor(row),
  });

  logger.info('Request status action', { action, requestId: id, userId: user.id });
  return getDetail(user, id);
}

function assignRequest(manager, id, technicianId, urgency, note) {
  const row = repositories.requests.findById(id);
  if (!row) {
    throw new AppError(`Request ${id} not found`, 404);
  }
  if (!canView(manager, row)) {
    throw new AppError('You do not have permission to assign this request.', 403);
  }
  if (manager.role !== 'manager') {
    throw new AppError('Only a property manager can assign a technician.', 403);
  }
  if (!['submitted', 'under-review'].includes(row.status)) {
    throw new AppError('Only submitted or under-review requests can be assigned.', 400);
  }
  const technician = repositories.technicians.findById(technicianId);
  if (!technician) {
    throw new AppError('Technician not found.', 404);
  }

  const when = nowStamp();
  repositories.requests.transaction(() => {
    repositories.requests.assign(id, technicianId, urgency, when);
    repositories.requests.addHistory({ requestId: id, status: statusLabel('assigned'), createdAt: when });
    repositories.requests.addComment({
      requestId: id,
      userId: manager.id,
      name: manager.name,
      roleLabel: roleLabel('manager'),
      text: note || `Assigned to ${technician.name}.`,
      createdAt: when,
    });
  });

  eventBus.emit('request.assigned', {
    type: 'request.assigned',
    at: when,
    actor: manager,
    request: eventRequest(row),
    technicianId,
    technicianUserId: technician.user_id,
    managerId: managerFor(row),
  });

  logger.info('Request assigned', { requestId: id, technicianId, managerId: manager.id });
  return getDetail(manager, id);
}

function rateRequest(tenant, id, stars) {
  const row = repositories.requests.findById(id);
  if (!row) {
    throw new AppError(`Request ${id} not found`, 404);
  }
  if (row.tenant_id !== tenant.id) {
    throw new AppError('Only the requesting tenant can rate this request.', 403);
  }
  if (row.status !== 'completed') {
    throw new AppError('Only completed requests can be rated.', 400);
  }
  if (repositories.requests.ratingFor(id)) {
    throw new AppError('This request has already been rated.', 400);
  }

  const when = nowStamp();
  repositories.requests.transaction(() => {
    repositories.requests.addRating({ requestId: id, userId: tenant.id, stars, createdAt: when });
    repositories.requests.addComment({
      requestId: id,
      userId: tenant.id,
      name: tenant.name,
      roleLabel: roleLabel('tenant'),
      text: `Tenant rated the completed work ${stars} out of 5.`,
      createdAt: when,
    });
  });

  eventBus.emit('request.rated', {
    type: 'request.rated',
    at: when,
    actor: tenant,
    request: eventRequest(row),
    stars,
    managerId: managerFor(row),
  });

  return getDetail(tenant, id);
}

function commentOnRequest(user, id, text) {
  const row = repositories.requests.findById(id);
  if (!row) {
    throw new AppError(`Request ${id} not found`, 404);
  }
  if (!canView(user, row)) {
    throw new AppError('You do not have permission to comment on this request.', 403);
  }
  const when = nowStamp();
  repositories.requests.addComment({
    requestId: id,
    userId: user.id,
    name: user.name,
    roleLabel: roleLabel(user.role),
    text,
    createdAt: when,
  });

  eventBus.emit('request.commented', {
    type: 'request.commented',
    at: when,
    actor: user,
    request: eventRequest(row),
    managerId: managerFor(row),
  });

  return getDetail(user, id);
}

function addPhoto(user, id) {
  const row = repositories.requests.findById(id);
  if (!row) {
    throw new AppError(`Request ${id} not found`, 404);
  }
  if (!canView(user, row)) {
    throw new AppError('You do not have permission to update this request.', 403);
  }
  const when = nowStamp();
  repositories.requests.incrementPhotos(id, when);

  eventBus.emit('request.photo_added', {
    type: 'request.photo_added',
    at: when,
    actor: user,
    request: eventRequest(row),
  });

  return getDetail(user, id);
}

function createRequest(tenant, body) {
  const units = repositories.users.unitsFor(tenant.id);
  // Derive the property from the unit the tenant selected rather than always
  // defaulting to the first unit in their list.
  const selectedUnit = units.find((u) => u.name === body.unit);
  if (!selectedUnit) {
    throw new AppError('You can only submit a request for one of your assigned units.', 400);
  }

  const when = nowStamp();
  const id = repositories.requests.allocateId();

  repositories.requests.transaction(() => {
    repositories.requests.insert({
      id,
      propertyId: selectedUnit.property_id,
      unit: body.unit,
      tenantId: tenant.id,
      category: body.category,
      title: body.title,
      detail: body.detail || 'No further details provided.',
      urgency: body.urgency,
      created: when.slice(0, 10),
      updated: when,
    });
    repositories.requests.addHistory({ requestId: id, status: statusLabel('submitted'), createdAt: when });
  });

  eventBus.emit('request.created', {
    type: 'request.created',
    at: when,
    actor: tenant,
    request: {
      id,
      title: body.title,
      tenantId: tenant.id,
      category: body.category,
      urgency: body.urgency,
      unit: body.unit,
    },
    managerId: (repositories.properties.findById(selectedUnit.property_id) || {}).manager_id || null,
  });

  logger.info('New request created', { requestId: id, tenantId: tenant.id, category: body.category });
  return getDetail(tenant, id);
}

module.exports = {
  listForUser,
  listToDetail,
  rowToDetail,
  getDetail,
  canView,
  allowedActions,
  canPerform,
  applyStatusAction,
  assignRequest,
  rateRequest,
  commentOnRequest,
  addPhoto,
  createRequest,
  resolveActor,
  nowStamp,
  OPEN_STATUSES,
};
