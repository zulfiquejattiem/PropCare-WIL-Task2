const { body, param, query, validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');

const CATEGORY_IDS = ['plumbing', 'electrical', 'hvac', 'security', 'appliances'];
const URGENCY_IDS = ['low', 'normal', 'high', 'urgent'];
const ROLE_IDS = ['tenant', 'manager', 'technician', 'admin'];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg);
    return next(new AppError(messages.join('. '), 400));
  }
  next();
};

const loginValidation = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

const createRequestValidation = [
  body('category')
    .trim()
    .isIn(CATEGORY_IDS)
    .withMessage(`Category must be one of: ${CATEGORY_IDS.join(', ')}`),
  body('urgency')
    .trim()
    .isIn(URGENCY_IDS)
    .withMessage(`Urgency must be one of: ${URGENCY_IDS.join(', ')}`),
  body('title')
    .trim()
    .notEmpty()
    .withMessage('A short title is required')
    .isLength({ max: 120 })
    .withMessage('Title must not exceed 120 characters'),
  body('detail')
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Details must not exceed 2000 characters'),
  body('unit')
    .trim()
    .notEmpty()
    .withMessage('Unit is required')
    .isLength({ max: 120 }),
  handleValidationErrors,
];

const assignValidation = [
  body('technicianId')
    .trim()
    .notEmpty()
    .withMessage('A technician must be selected')
    .matches(/^T\d+$/)
    .withMessage('Invalid technician id'),
  body('urgency')
    .trim()
    .isIn(URGENCY_IDS)
    .withMessage(`Urgency must be one of: ${URGENCY_IDS.join(', ')}`),
  body('note')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Note must not exceed 500 characters'),
  handleValidationErrors,
];

const commentValidation = [
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Comment text is required')
    .isLength({ max: 1000 })
    .withMessage('Comment must not exceed 1000 characters'),
  handleValidationErrors,
];

const rateValidation = [
  body('stars')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be a whole number between 1 and 5'),
  handleValidationErrors,
];

const statusActionValidation = [
  param('id')
    .matches(/^REQ-\d+$/)
    .withMessage('Invalid request id'),
  body('action')
    .trim()
    .isIn(['cancel', 'confirm', 'reopen', 'approve', 'accept', 'reject', 'hold', 'resume', 'complete'])
    .withMessage('Invalid status action'),
  body('text')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Note must not exceed 1000 characters'),
  handleValidationErrors,
];

const requestIdParam = [
  param('id')
    .matches(/^REQ-\d+$/)
    .withMessage('Invalid request id'),
  handleValidationErrors,
];

const listRequestsValidation = [
  query('status')
    .optional()
    .trim()
    .isIn(['submitted', 'under-review', 'assigned', 'in-progress', 'on-hold', 'completed', 'closed', 'cancelled', 'rejected'])
    .withMessage('Invalid status filter'),
  query('category')
    .optional()
    .trim()
    .isIn(CATEGORY_IDS)
    .withMessage('Invalid category filter'),
  query('q')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('Search term too long'),
  handleValidationErrors,
];

const registerUserValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 100 })
    .withMessage('Name must not exceed 100 characters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/\d/)
    .withMessage('Password must contain at least one number'),
  body('role')
    .trim()
    .isIn(ROLE_IDS)
    .withMessage(`Role must be one of: ${ROLE_IDS.join(', ')}`),
  // Optional extras that make a newly created account immediately usable.
  body('skill')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 60 })
    .withMessage('Skill must not exceed 60 characters'),
  body('propertyId')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^P\d+$/)
    .withMessage('Invalid property id'),
  body('unit')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('Unit must not exceed 120 characters'),
  handleValidationErrors,
];

const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Name must not exceed 100 characters'),


  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .normalizeEmail(),


  body('password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage(
      'New password must contain at least one uppercase letter'
    )
    .matches(/[a-z]/)
    .withMessage(
      'New password must contain at least one lowercase letter'
    )
    .matches(/\d/)
    .withMessage(
      'New password must contain at least one number'
    ),


  handleValidationErrors,
];

module.exports = {
  loginValidation,
  createRequestValidation,
  assignValidation,
  commentValidation,
  rateValidation,
  statusActionValidation,
  requestIdParam,
  listRequestsValidation,
  registerUserValidation,
  updateProfileValidation,
};