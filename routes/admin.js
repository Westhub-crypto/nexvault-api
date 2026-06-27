const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getAnalytics, getUsers, suspendUser, activateUser, deleteUser,
  topUpBalance, deductBalance, getTransactions,
  approveActivation, rejectActivation,
  approveDeposit, rejectDeposit,
  approveWithdrawal, rejectWithdrawal,
  sendAnnouncement, getAuditLogs
} = require('../controllers/adminController');

router.use(protect, restrictTo('admin'));

router.get('/analytics', getAnalytics);
router.get('/users', getUsers);
router.put('/users/:id/suspend', suspendUser);
router.put('/users/:id/activate', activateUser);
router.delete('/users/:id', deleteUser);
router.put('/users/:id/topup', topUpBalance);
router.put('/users/:id/deduct', deductBalance);
router.get('/transactions', getTransactions);
router.put('/transactions/:id/approve-activation', approveActivation);
router.put('/transactions/:id/reject-activation', rejectActivation);
router.put('/transactions/:id/approve-deposit', approveDeposit);
router.put('/transactions/:id/reject-deposit', rejectDeposit);
router.put('/transactions/:id/approve-withdrawal', approveWithdrawal);
router.put('/transactions/:id/reject-withdrawal', rejectWithdrawal);
router.post('/announce', sendAnnouncement);
router.get('/audit-logs', getAuditLogs);

module.exports = router;
