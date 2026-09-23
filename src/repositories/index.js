/**
 * Repository registry.
 *
 * One long-lived instance per repository (so the prepared-statement cache is
 * shared across requests) exposed as a single injectable object. Services take
 * `repositories` as a dependency, which keeps them unit-testable.
 */
const { UserRepository } = require('./user.repository');
const { PropertyRepository } = require('./property.repository');
const { RequestRepository } = require('./request.repository');
const { TechnicianRepository } = require('./technician.repository');
const { ReferenceRepository } = require('./reference.repository');
const { NotificationRepository } = require('./notification.repository');
const { AuditRepository } = require('./audit.repository');

const repositories = {
  users: new UserRepository(),
  properties: new PropertyRepository(),
  requests: new RequestRepository(),
  technicians: new TechnicianRepository(),
  reference: new ReferenceRepository(),
  notifications: new NotificationRepository(),
  audit: new AuditRepository(),
};

module.exports = { repositories };
