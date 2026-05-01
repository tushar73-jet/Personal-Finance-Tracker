const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('../db');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'placeholder_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder_client_secret',
    callbackURL: "/api/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const googleId = profile.id;
      const name = profile.displayName;

      // Check if user exists
      let userResult = await pool.query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [googleId, email]);
      
      if (userResult.rows.length === 0) {
        // Create new user
        userResult = await pool.query(
          'INSERT INTO users (name, email, google_id) VALUES ($1, $2, $3) RETURNING *',
          [name, email, googleId]
        );
      } else if (!userResult.rows[0].google_id) {
        // Link google account to existing email account
        userResult = await pool.query(
          'UPDATE users SET google_id = $1 WHERE email = $2 RETURNING *',
          [googleId, email]
        );
      }

      return done(null, userResult.rows[0]);
    } catch (err) {
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, userResult.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
