const express = require('express');
const router = express.Router();
const { protect, requireActive } = require('../middleware/auth');
const {
  upload, getWalletInfo, submitActivation, submitDeposit,
  submitWithdrawal, transferFunds, getTransactions,
  getNotifications, markNotificationRead, markAllNotificationsRead
} = require('../controllers/transactionController');

router.get('/wallet-info', protect, getWalletInfo);
router.post('/activation', protect, upload.single('proof'), submitActivation);
router.post('/deposit', protect, requireActive, upload.single('proof'), submitDeposit);
router.post('/withdrawal', protect, requireActive, upload.single('gasFeeProof'), submitWithdrawal);
router.post('/transfer', protect, requireActive, transferFunds);
router.get('/', protect, getTransactions);
router.get('/notifications', protect, getNotifications);
router.put('/notifications/:id/read', protect, markNotificationRead);
router.put('/notifications/read-all', protect, markAllNotificationsRead);

module.exports = router;
