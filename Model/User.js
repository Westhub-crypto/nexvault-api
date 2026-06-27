const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [100, 'Full name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  withdrawalPin: {
    type: String,
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended'],
    default: 'pending'
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  activationPaid: {
    type: Boolean,
    default: false
  },
  activationProof: {
    type: String
  },
  activationStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none'
  },
  avatar: {
    type: String,
    default: null
  },
  lastLogin: {
    type: Date
  },
  passwordChangedAt: {
    type: Date
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Hash withdrawal PIN before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('withdrawalPin') || !this.withdrawalPin) return next();
  this.withdrawalPin = await bcrypt.hash(this.withdrawalPin, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Compare withdrawal PIN
userSchema.methods.compareWithdrawalPin = async function(candidatePin) {
  return await bcrypt.compare(candidatePin, this.withdrawalPin);
};

module.exports = mongoose.model('User', userSchema);
