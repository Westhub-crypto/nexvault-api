const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const path = require('path');
require('dotenv').config();

const app = express();

// Trust proxy (needed on Render)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(mongoSanitize());
app.use(hpp());

// CORS — allow all origins (tighten after confirming URLs)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => res.json({
  status: 'NexVault API is running',
  time: new Date(),
  env: process.env.NODE_ENV,
}));


// Debug route — test login directly (remove after confirming login works)
app.post('/api/debug/test-login', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { email, password } = req.body;
    const db = mongoose.connection.db;
    const user = await db.collection('users').findOne({ email: email?.toLowerCase().trim() });
    if (!user) return res.json({ found: false, message: 'No user with that email' });
    const match = await bcrypt.compare(password, user.password);
    res.json({
      found: true,
      email: user.email,
      role: user.role,
      status: user.status,
      passwordMatch: match,
      hasHashedPassword: user.password?.startsWith('$2'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error.' });
});

// Admin seed — always force-resets password and role on every boot
const seedAdmin = async () => {
  try {
    const bcrypt = require('bcryptjs');
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPass = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPass) {
      console.log('⚠️  ADMIN_EMAIL or ADMIN_PASSWORD not set in environment. Skipping admin seed.');
      return;
    }

    const db = mongoose.connection.db;
    const usersCol = db.collection('users');

    // Always hash the password fresh
    const hashedPassword = await bcrypt.hash(adminPass, 12);

    const existing = await usersCol.findOne({ email: adminEmail });

    if (!existing) {
      await usersCol.insertOne({
        fullName: 'NexVault Admin',
        email: adminEmail,
        phone: '+00000000000',
        country: 'Global',
        password: hashedPassword,
        role: 'admin',
        status: 'active',
        activationStatus: 'approved',
        balance: 0,
        activationPaid: true,
        withdrawalPin: null,
        avatar: null,
        lastLogin: null,
        passwordChangedAt: null,
        isEmailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('✅ Admin account created:', adminEmail);
    } else {
      // Always force-reset password + role so credentials in .env always work
      await usersCol.updateOne(
        { email: adminEmail },
        {
          $set: {
            password: hashedPassword,
            role: 'admin',
            status: 'active',
            activationStatus: 'approved',
            updatedAt: new Date(),
          },
        }
      );
      console.log('✅ Admin password & role synced for:', adminEmail);
    }
  } catch (err) {
    console.error('❌ Admin seed error:', err.message);
  }
};

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected.');
    await seedAdmin();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`✅ NexVault server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
                                             
