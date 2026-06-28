const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
};

exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const { fullName, email, phone, country, password } = req.body;

    // Check if email exists directly via collection (catches both Mongoose docs and raw inserts)
    const db = mongoose.connection.db;
    const existing = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already in use.' });
    }

    const user = await User.create({
      fullName,
      email: email.toLowerCase().trim(),
      phone,
      country,
      password,
      status: 'pending',
      activationStatus: 'none',
    });

    const token = signToken(user._id);
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please pay the activation fee.',
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        country: user.country,
        role: user.role,
        status: user.status,
        activationStatus: user.activationStatus,
        balance: user.balance,
      },
    });
  } catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ success: false, message: 'Registration failed.', error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    const emailClean = email.toLowerCase().trim();

    // Fetch raw from MongoDB so we always get the password field regardless of how user was created
    const db = mongoose.connection.db;
    const rawUser = await db.collection('users').findOne({ email: emailClean });

    if (!rawUser) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Compare password directly with bcrypt
    const passwordMatch = await bcrypt.compare(password, rawUser.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (rawUser.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
    }

    // Update lastLogin
    await db.collection('users').updateOne(
      { _id: rawUser._id },
      { $set: { lastLogin: new Date() } }
    );

    const token = signToken(rawUser._id);
    const isAdmin = rawUser.role === 'admin';

    res.json({
      success: true,
      token,
      isAdmin,
      user: {
        _id: rawUser._id,
        fullName: rawUser.fullName,
        email: rawUser.email,
        phone: rawUser.phone,
        country: rawUser.country,
        role: rawUser.role,
        status: rawUser.status,
        activationStatus: rawUser.activationStatus,
        balance: rawUser.balance || 0,
        avatar: rawUser.avatar || null,
        lastLogin: new Date(),
      },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ success: false, message: 'Login failed.', error: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
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
    const db = mongoose.connection.db;
    const rawUser = await db.collection('users').findOne({ _id: req.user._id });
    const match = await bcrypt.compare(currentPassword, rawUser.password);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: { password: hashed, passwordChangedAt: new Date() } }
    );
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
    const db = mongoose.connection.db;
    const rawUser = await db.collection('users').findOne({ _id: req.user._id });

    if (rawUser.withdrawalPin && currentPin) {
      const isValid = await bcrypt.compare(currentPin, rawUser.withdrawalPin);
      if (!isValid) {
        return res.status(400).json({ success: false, message: 'Current PIN is incorrect.' });
      }
    }

    const hashedPin = await bcrypt.hash(pin, 12);
    await db.collection('users').updateOne(
      { _id: req.user._id },
      { $set: { withdrawalPin: hashedPin } }
    );

    res.json({ success: true, message: 'Withdrawal PIN set successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
    
