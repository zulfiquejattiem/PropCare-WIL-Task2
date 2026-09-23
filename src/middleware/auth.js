const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');
const { repositories } = require('../repositories');
const logger = require('../utils/logger');

const ISSUER = 'propcare';
const AUDIENCE = 'propcare-api';

const JWT_VERIFY_OPTIONS = {
  algorithms: ['HS256'],
  issuer: ISSUER,
  audience: AUDIENCE,
};

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Access denied. No token provided.', 401));
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (!token) {
    return next(new AppError('Access denied. No token provided.', 401));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);

    // Always check the current database account. This means deactivated users
    // cannot continue using an already-issued JWT.
    const user = repositories.users.findByIdFull(decoded.id);

    if (!user) {
      return next(new AppError('User account no longer exists.', 401));
    }

    if (!user.active) {
      return next(new AppError('This account has been deactivated. Contact an administrator.', 403));
    }

    // Use current database values instead of trusting stale role/name/email
    // values that may exist inside an older JWT.
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      active: Boolean(user.active),
    };

    next();
  } catch (err) {
    logger.warn('Invalid JWT token attempt', { ip: req.ip, url: req.originalUrl });

    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Token has expired. Please login again.', 401));
    }

    return next(new AppError('Invalid token. Access denied.', 401));
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };
};

module.exports = { authenticate, authorize, ISSUER, AUDIENCE };
