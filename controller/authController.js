const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const Notification = require('../models/Notification');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
};

exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const { fullName, email, phone, country, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already in use.' });
    }
    const user = await User.create({ fullName, email, phone, country, password, status: 'pending', activationStatus: 'none' });
    const token = signToken(user._id);
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please pay the activation fee.',
      token,
      user: {
        _id: user._id, fullName: user.fullName, email: user.email,
        phone: user.phone, country: user.country, role: user.role,
        status: user.status, activationStatus: user.activationStatus, balance: user.balance
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Registration failed.', error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }
    const user = await User.findOne({ email }).seulect('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
    }
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    const token = signToken(user._id);
    const isAdmin = user.role === 'admin';
    res.json({
      success: true,
      token,
      isAdmin,
      user: {
        _id: user._id, fullName: user.fullName, email: user.email,
        phone: user.phone, country: user.country, role: user.role,
        status: user.status, activationStatus: user.activationStatus,
        balance: user.balance, avatar: user.avatar, lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Login failed.', error: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { fullName, phone, country } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { fullName, phone, country },
      { new: true, runValidators: true }
    );
    res.json({ success: true, message: 'Profile updated successfully.', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setWithdrawalPin = async (req, res) => {
  try {
    const { pin, currentPin } = req.body;
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ success: false, message: 'PIN must be exactly 4 digits.' });
    }
    const user = await User.findById(req.user._id).select('+withdrawalPin');
    if (user.withdrawalPin && currentPin) {
      const isValid = await user.compareWithdrawalPin(currentPin);
      if (!isValid) {
        return res.status(400).json({ success: false, message: 'Current PIN is incorrect.' });
      }
    }
    user.withdrawalPin = pin;
    await user.save();
    res.json({ success: true, message: 'Withdrawal PIN set successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
