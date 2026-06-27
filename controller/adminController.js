const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

const logAction = async (adminId, action, targetUser, targetTransaction, details, ipAddress) => {
  await AuditLog.create({ admin: adminId, action, targetUser, targetTransaction, details, ipAddress });
};

const createNotification = async (userId, title, message, type, transactionId = null) => {
  await Notification.create({ user: userId, title, message, type, relatedTransaction: transactionId });
};

// Dashboard analytics
exports.getAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const activeUsers = await User.countDocuments({ status: 'active', role: 'user' });
    const pendingUsers = await User.countDocuments({ status: 'pending', role: 'user' });
    const suspendedUsers = await User.countDocuments({ status: 'suspended', role: 'user' });
    const totalDeposited = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalWithdrawn = await Transaction.aggregate([
      { $match: { type: 'withdrawal', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const pendingDeposits = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdrawal', status: 'pending' });
    const pendingActivations = await Transaction.countDocuments({ type: 'activation', status: 'pending' });
    const recentTransactions = await Transaction.find()
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 }).limit(10);
    const monthlyStats = await Transaction.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000) } } },
      { $group: {
        _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' }, type: '$type' },
        total: { $sum: '$amount' }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    const totalBalances = await User.aggregate([
      { $match: { role: 'user' } },
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);
    res.json({
      success: true,
      analytics: {
        totalUsers, activeUsers, pendingUsers, suspendedUsers,
        totalDeposited: totalDeposited[0]?.total || 0,
        totalWithdrawn: totalWithdrawn[0]?.total || 0,
        pendingDeposits, pendingWithdrawals, pendingActivations,
        totalBalances: totalBalances[0]?.total || 0,
        recentTransactions, monthlyStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all users
exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search;
    const status = req.query.status;
    const filter = { role: 'user' };
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) filter.status = status;
    const total = await User.countDocuments(filter);
    const users = await User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, users, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Suspend user
exports.suspendUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: 'suspended' }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await createNotification(user._id, 'Account Suspended', 'Your account has been suspended. Contact support.', 'system');
    await logAction(req.user._id, 'SUSPEND_USER', user._id, null, {}, req.ip);
    res.json({ success: true, message: 'User suspended.', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Activate user
exports.activateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: 'active', activationStatus: 'approved' }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await createNotification(user._id, 'Account Activated', 'Your account has been activated. Welcome to NexVault!', 'activation');
    await logAction(req.user._id, 'ACTIVATE_USER', user._id, null, {}, req.ip);
    res.json({ success: true, message: 'User activated.', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete user
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await logAction(req.user._id, 'DELETE_USER', req.params.id, null, { email: user.email }, req.ip);
    res.json({ success: true, message: 'User deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Top up balance
exports.topUpBalance = async (req, res) => {
  try {
    const { amount, note } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required.' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { $inc: { balance: parseFloat(amount) } }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    await createNotification(user._id, 'Balance Credited', `$${amount} USDT has been added to your wallet.`, 'deposit');
    await logAction(req.user._id, 'TOPUP_BALANCE', user._id, null, { amount, note }, req.ip);
    res.json({ success: true, message: 'Balance updated.', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Deduct balance
exports.deductBalance = async (req, res) => {
  try {
    const { amount, note } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required.' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.balance < parseFloat(amount)) {
      return res.status(400).json({ success: false, message: 'Insufficient user balance.' });
    }
    await User.findByIdAndUpdate(req.params.id, { $inc: { balance: -parseFloat(amount) } });
    await createNotification(user._id, 'Balance Deducted', `$${amount} USDT has been deducted from your wallet.`, 'system');
    await logAction(req.user._id, 'DEDUCT_BALANCE', user._id, null, { amount, note }, req.ip);
    res.json({ success: true, message: 'Balance deducted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all transactions
exports.getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type;
    const status = req.query.status;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .populate('user', 'fullName email')
      .populate('recipientUser', 'fullName email')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve activation
exports.approveActivation = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'activation') {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    tx.status = 'approved';
    tx.processedBy = req.user._id;
    tx.processedAt = new Date();
    tx.adminNote = req.body.note;
    await tx.save();
    await User.findByIdAndUpdate(tx.user, { status: 'active', activationStatus: 'approved' });
    await createNotification(tx.user, 'Account Activated!', 'Your activation payment has been approved. Welcome to NexVault!', 'activation', tx._id);
    await logAction(req.user._id, 'APPROVE_ACTIVATION', tx.user, tx._id, {}, req.ip);
    res.json({ success: true, message: 'Activation approved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reject activation
exports.rejectActivation = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'activation') {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    tx.status = 'rejected';
    tx.processedBy = req.user._id;
    tx.processedAt = new Date();
    tx.adminNote = req.body.note;
    await tx.save();
    await User.findByIdAndUpdate(tx.user, { activationStatus: 'rejected' });
    await createNotification(tx.user, 'Activation Rejected', `Your activation payment was rejected. ${req.body.note || ''}`, 'activation', tx._id);
    await logAction(req.user._id, 'REJECT_ACTIVATION', tx.user, tx._id, {}, req.ip);
    res.json({ success: true, message: 'Activation rejected.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve deposit
exports.approveDeposit = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'deposit') {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    tx.status = 'approved';
    tx.processedBy = req.user._id;
    tx.processedAt = new Date();
    await tx.save();
    await User.findByIdAndUpdate(tx.user, { $inc: { balance: tx.amount } });
    await createNotification(tx.user, 'Deposit Approved', `Your deposit of $${tx.amount} USDT has been credited.`, 'deposit', tx._id);
    await logAction(req.user._id, 'APPROVE_DEPOSIT', tx.user, tx._id, {}, req.ip);
    res.json({ success: true, message: 'Deposit approved and credited.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reject deposit
exports.rejectDeposit = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'deposit') {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    tx.status = 'rejected';
    tx.processedBy = req.user._id;
    tx.processedAt = new Date();
    tx.adminNote = req.body.note;
    await tx.save();
    await createNotification(tx.user, 'Deposit Rejected', `Your deposit of $${tx.amount} was rejected. ${req.body.note || ''}`, 'deposit', tx._id);
    await logAction(req.user._id, 'REJECT_DEPOSIT', tx.user, tx._id, {}, req.ip);
    res.json({ success: true, message: 'Deposit rejected.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Approve withdrawal
exports.approveWithdrawal = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'withdrawal') {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    const user = await User.findById(tx.user);
    if (user.balance < tx.amount) {
      return res.status(400).json({ success: false, message: 'User has insufficient balance.' });
    }
    tx.status = 'approved';
    tx.processedBy = req.user._id;
    tx.processedAt = new Date();
    await tx.save();
    await User.findByIdAndUpdate(tx.user, { $inc: { balance: -tx.amount } });
    await createNotification(tx.user, 'Withdrawal Approved', `Your withdrawal of $${tx.amount} USDT has been approved and processed.`, 'withdrawal', tx._id);
    await logAction(req.user._id, 'APPROVE_WITHDRAWAL', tx.user, tx._id, {}, req.ip);
    res.json({ success: true, message: 'Withdrawal approved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reject withdrawal
exports.rejectWithdrawal = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'withdrawal') {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    tx.status = 'rejected';
    tx.processedBy = req.user._id;
    tx.processedAt = new Date();
    tx.adminNote = req.body.note;
    await tx.save();
    await createNotification(tx.user, 'Withdrawal Rejected', `Your withdrawal of $${tx.amount} was rejected. ${req.body.note || ''}`, 'withdrawal', tx._id);
    await logAction(req.user._id, 'REJECT_WITHDRAWAL', tx.user, tx._id, {}, req.ip);
    res.json({ success: true, message: 'Withdrawal rejected.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send notification to all users
exports.sendAnnouncement = async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message required.' });
    }
    const users = await User.find({ role: 'user', status: 'active' });
    const notifications = users.map(u => ({
      user: u._id, title, message, type: 'announcement'
    }));
    await Notification.insertMany(notifications);
    await logAction(req.user._id, 'SEND_ANNOUNCEMENT', null, null, { title, userCount: users.length }, req.ip);
    res.json({ success: true, message: `Announcement sent to ${users.length} users.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get audit logs
exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .populate('admin', 'fullName email')
      .populate('targetUser', 'fullName email')
      .sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
