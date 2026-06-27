const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    unique: true,
    default: () => 'TXN' + uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'activation', 'gas_fee'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  gasFee: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  proofOfPayment: {
    type: String
  },
  gasFeeProof: {
    type: String
  },
  recipientUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  recipientEmail: {
    type: String
  },
  note: {
    type: String,
    maxlength: 500
  },
  adminNote: {
    type: String
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedAt: {
    type: Date
  },
  walletAddress: {
    type: String
  },
  networkFee: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transaction', transactionSchema);
