const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { seedDatabase } = require('./db');
const { registerObservers } = require('./observers');
const { errorHandler, notFoundHandler, AppError } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const propertyRoutes = require('./routes/properties');
const requestRoutes = require('./routes/requests');
const technicianRoutes = require('./routes/technicians');
const tenantRoutes = require('./routes/tenants');
const referenceRoutes = require('./routes/categories');
const notificationRoutes = require('./routes/notifications');
const auditRoutes = require('./routes/audit');
const reportRoutes = require('./routes/reports');
const logger = require('./utils/logger');

const app = express();

const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const limiter = isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      // Only non-2xx responses consume quota, so heavy normal usage and
      // multi-run browser suites never lock legitimate users out of the demo.
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        status: 'error',
        statusCode: 429,
        message: 'Too many requests. Please try again later.',
      },
    });

const authLimiter = isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      // Failed login attempts only (see skipSuccessfulRequests): brute force
      // is still throttled but successful sign-ins never count against a user.
      limit: 100,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        status: 'error',
        statusCode: 429,
        message: 'Too many authentication attempts. Please try again later.',
      },
    });

/* ------------------------------------------------------------------ */
/* Domain events: register the observers once, at boot.                */
/* ------------------------------------------------------------------ */

registerObservers();

/* ------------------------------------------------------------------ */
/* Database seeding                                                    */
/* ------------------------------------------------------------------ */

// Database seeding is idempotent; await it before handling any request.
// The rejection is handled here as well as per-request so a misconfigured
// DEMO_PASSWORD logs a clear error instead of crashing the process with an
// unhandled rejection before the server can even start listening.
const seedPromise = seedDatabase();
let seedError = null;

seedPromise.catch((err) => {
  seedError = err;
  process.stderr.write(`[propcare] seed failure: ${err.message}\n`);
  logger.error('Database seeding failed', { message: err.message });
});

app.use((req, res, next) => {
  seedPromise
    .then(() => next())
    .catch(() => next());
});

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: isTest
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without Origin include curl, Postman and server-to-server calls.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Reject the origin without converting the request into an
      // application-level 500 error.
      return callback(null, false);
    },
  })
);
app.use(express.json({ limit: '32kb' }));
if (!isTest) app.use(morgan('short'));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Invalid JSON payload',
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      status: 'error',
      statusCode: 413,
      message: 'Request body too large',
    });
  }
  next(err);
});

// Static front end (Task 2 app) - cached for performance.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: isTest ? 0 : '1h',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

// API health + welcome
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'PropCare API is running',
    data: { database: seedError ? 'not seeded' : 'ready', time: new Date().toISOString() },
  });
});

app.get('/api', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Welcome to the PropCare API',
    data: {
      name: 'PropCare',
      description: 'Smart property maintenance management - Obs Realty Group',
      baseUrl: '/api',
      endpoints: {
        health: 'GET /api/health',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        requests: 'GET/POST /api/requests',
        requestDetail: 'GET /api/requests/:id',
        requestStatus: 'POST /api/requests/:id/status',
        requestAssign: 'POST /api/requests/:id/assign',
        requestRate: 'POST /api/requests/:id/rate',
        requestComments: 'POST /api/requests/:id/comments',
        requestPhotos: 'POST /api/requests/:id/photos',
        categories: 'GET /api/categories',
        properties: 'GET /api/properties',
        technicians: 'GET /api/technicians',
        tenants: 'GET /api/tenants',
        notifications: 'GET /api/notifications',
        auditLog: 'GET /api/audit-log (admin)',
        reports: 'GET /api/reports/summary',
      },
    },
  });
});

// Rate limiters
app.use('/api', limiter);
app.use('/api/auth/login', authLimiter);

// Routers
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/technicians', technicianRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api', referenceRoutes); // categories, statuses, urgencies
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit-log', auditRoutes);
app.use('/api/reports', reportRoutes);

/**
 * SPA fallback - serve index.html for non-API routes.
 *
 * Paths that look like a static asset (an extension) are *not* rewritten:
 * they must 404 so a broken <script>/<link> reference surfaces immediately
 * instead of silently serving HTML to the browser.
 */
const ASSET_EXTENSION = /\.[a-z0-9]{1,5}$/i;

app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (ASSET_EXTENSION.test(req.path)) {
    return next(new AppError(`Asset ${req.path} not found`, 404));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
module.exports.getSeedError = () => seedError;
