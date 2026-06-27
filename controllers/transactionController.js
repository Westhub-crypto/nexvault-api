const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Notification = require('../models/Notification');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');

// Multer config for proof uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `proof_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|pdf|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error('Only images and PDFs are allowed.'));
};
exports.upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

const createNotification = async (userId, title, message, type, transactionId = null) => {
  await Notification.create({
    user: userId, title, message, type,
    relatedTransaction: transactionId
  });
};

// Get wallet info (addresses + QR codes)
exports.getWalletInfo = async (req, res) => {
  try {
    const depositAddress = process.env.DEPOSIT_WALLET_ADDRESS || 'Address not configured yet';
    const activationAddress = process.env.ACTIVATION_WALLET_ADDRESS || 'Address not configured yet';
    const gasFeeAddress = process.env.GAS_FEE_WALLET_ADDRESS || 'Address not configured yet';
    const depositQR = await QRCode.toDataURL(depositAddress);
    const activationQR = await QRCode.toDataURL(activationAddress);
    const gasFeeQR = await QRCode.toDataURL(gasFeeAddress);
    res.json({
      success: true,
      depositAddress, depositQR,
      activationAddress, activationQR,
      gasFeeAddress, gasFeeQR,
      activationFee: process.env.ACTIVATION_FEE || 50,
      gasFeePct: process.env.GAS_FEE_PERCENTAGE || 10
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Submit activation payment
exports.submitActivation = async (req, res) => {
  try {
    if (req.user.activationStatus === 'approved') {
      return res.status(400).json({ success: false, message: 'Account already activated.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload proof of payment.' });
    }
    const tx = await Transaction.create({
      user: req.user._id,
      type: 'activation',
      amount: parseFloat(process.env.ACTIVATION_FEE) || 50,
      proofOfPayment: req.file.filename,
      status: 'pending'
    });
    await User.findByIdAndUpdate(req.user._id, { activationStatus: 'pending' });
    res.json({ success: true, message: 'Activation payment submitted. Awaiting admin approval.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Submit deposit
exports.submitDeposit = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload proof of payment.' });
    }
    const tx = await Transaction.create({
      user: req.user._id,
      type: 'deposit',
      amount: parseFloat(amount),
      proofOfPayment: req.file.filename,
      status: 'pending'
    });
    await createNotification(req.user._id, 'Deposit Submitted', `Your deposit of $${amount} USDT is under review.`, 'deposit', tx._id);
    res.json({ success: true, message: 'Deposit submitted for review.', transaction: tx });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Submit withdrawal
exports.submitWithdrawal = async (req, res) => {
  try {
    const { amount, walletAddress, pin } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required.' });
    }
    if (!walletAddress) {
      return res.status(400).json({ success: false, message: 'Wallet address required.' });
    }
    if (!pin) {
      return res.status(400).json({ success: false, message: 'Withdrawal PIN required.' });
    }
    const user = await User.findById(req.user._id).select('+withdrawalPin');
    if (!user.withdrawalPin) {
      return res.status(400).json({ success: false, message: 'Please set a withdrawal PIN first.' });
    }
    const pinValid = await user.compareWithdrawalPin(pin);
    if (!pinValid) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal PIN.' });
    }
    const withdrawAmount = parseFloat(amount);
    if (user.balance < withdrawAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }
    const gasFee = withdrawAmount * (parseFloat(process.env.GAS_FEE_PERCENTAGE) || 10) / 100;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload gas fee payment proof.' });
    }
    const tx = await Transaction.create({
      user: req.user._id,
      type: 'withdrawal',
      amount: withdrawAmount,
      gasFee,
      walletAddress,
      gasFeeProof: req.file.filename,
      status: 'pending'
    });
    await createNotification(req.user._id, 'Withdrawal Requested', `Withdrawal of $${withdrawAmount} USDT submitted for review.`, 'withdrawal', tx._id);
    res.json({ success: true, message: 'Withdrawal request submitted for admin review.', transaction: tx, gasFee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Transfer to another user
exports.transferFunds = async (req, res) => {
  try {
    const { recipientEmail, amount, pin, note } = req.body;
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required.' });
    }
    const sender = await User.findById(req.user._id).select('+withdrawalPin');
    if (!sender.withdrawalPin) {
      return res.status(400).json({ success: false, message: 'Please set a withdrawal PIN first.' });
    }
    const pinValid = await sender.compareWithdrawalPin(pin);
    if (!pinValid) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal PIN.' });
    }
    const transferAmount = parseFloat(amount);
    if (sender.balance < transferAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }
    const recipient = await User.findOne({ email: recipientEmail, status: 'active' });
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Recipient not found or inactive.' });
    }
    if (recipient._id.toString() === sender._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot transfer to yourself.' });
    }
    // Debit sender
    await User.findByIdAndUpdate(sender._id, { $inc: { balance: -transferAmount } });
    // Credit recipient
    await User.findByIdAndUpdate(recipient._id, { $inc: { balance: transferAmount } });
    const txOut = await Transaction.create({
      user: sender._id, type: 'transfer_out', amount: transferAmount,
      recipientUser: recipient._id, recipientEmail, note, status: 'completed'
    });
    const txIn = await Transaction.create({
      user: recipient._id, type: 'transfer_in', amount: transferAmount,
      recipientUser: sender._id, recipientEmail: sender.email, note, status: 'completed'
    });
    await createNotification(sender._id, 'Transfer Sent', `You sent $${transferAmount} USDT to ${recipient.fullName}.`, 'transfer', txOut._id);
    await createNotification(recipient._id, 'Transfer Received', `You received $${transferAmount} USDT from ${sender.fullName}.`, 'transfer', txIn._id);
    res.json({ success: true, message: `Transfer of $${transferAmount} USDT to ${recipient.fullName} completed.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get transaction history
exports.getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type;
    const filter = { user: req.user._id };
    if (type) filter.type = type;
    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({ success: true, transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get notifications
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ user: req.user._id, isRead: false });
    res.json({ success: true, notifications, unread });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark notification read
exports.markNotificationRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark all notifications read
exports.markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
