const express = require('express');
const router = express.Router();
const { protect, requireActive } = require('../middleware/auth');
const {
  register, login, getMe, updateProfile, changePassword, setWithdrawalPin
} = require('../controllers/authController');
const { body } = require('express-validator');

router.post('/register', [
  body('fullName').notEmpty().trim().withMessage('Full name required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('phone').notEmpty().withMessage('Phone required'),
  body('country').notEmpty().withMessage('Country required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], register);

router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);
router.put('/withdrawal-pin', protect, requireActive, setWithdrawalPin);

module.exports = router;
