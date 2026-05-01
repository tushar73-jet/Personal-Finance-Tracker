const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const transactionRoutes = require('./routes/transactions');
const passport = require('passport');

const app = express();

app.use(helmet({
  contentSecurityPolicy: false, // Disable for demo purposes to allow CDN scripts/styles easily
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(passport.initialize());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
