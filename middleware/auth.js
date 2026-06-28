const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. Please log in.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Use raw MongoDB to find user (works for both Mongoose-created and raw-inserted docs)
    const db = mongoose.connection.db;
    const { ObjectId } = mongoose.Types;

    let userId;
    try {
      userId = new ObjectId(decoded.id);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }

    const user = await db.collection('users').findOne({ _id: userId });
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account suspended.' });
    }

    // Attach user to request (compatible shape with rest of app)
    req.user = {
      _id: user._id,
      id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      country: user.country,
      role: user.role,
      status: user.status,
      activationStatus: user.activationStatus,
      balance: user.balance || 0,
      avatar: user.avatar || null,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

exports.requireActive = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  if (req.user.status !== 'active') {
    return res.status(403).json({
      success: false,
      message: 'Account not active. Please complete activation.',
      activationStatus: req.user.activationStatus,
      status: req.user.status,
    });
  }
  next();
};
