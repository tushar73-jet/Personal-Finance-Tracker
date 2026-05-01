const nodemailer = require('nodemailer');
const pool = require('../db');

// Placeholder for email transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
  port: process.env.EMAIL_PORT || 587,
  auth: {
    user: process.env.EMAIL_USER || 'placeholder@example.com',
    pass: process.env.EMAIL_PASS || 'password'
  }
});

async function checkBudget(userId, categoryId) {
  if (!categoryId) return;
  
  try {
    const categoryResult = await pool.query(
      'SELECT name, budget, type FROM categories WHERE id = $1 AND user_id = $2',
      [categoryId, userId]
    );

    if (categoryResult.rows.length === 0) return;

    const { name, budget, type } = categoryResult.rows[0];
    if (type !== 'expense' || budget <= 0) return;

    const spendingResult = await pool.query(
      'SELECT SUM(amount) as spent FROM transactions WHERE user_id = $1 AND category_id = $2',
      [userId, categoryId]
    );

    const spent = parseFloat(spendingResult.rows[0].spent || 0);

    if (spent > budget) {
      const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      const email = userResult.rows[0].email;

      // In a real scenario, you'd use a service like SendGrid
      console.log(`[BUDGET ALERT] Sending email to ${email}: Exceeded ${name} budget. Spent: ${spent}, Budget: ${budget}`);
      
      try {
        await transporter.sendMail({
          from: '"Finance Tracker" <no-reply@finance.com>',
          to: email,
          subject: `Budget Overrun Alert: ${name}`,
          text: `You have exceeded your budget for ${name}. Budget: ${budget}, Spent: ${spent}`,
          html: `<p>You have exceeded your budget for <b>${name}</b>.</p><p>Budget: ${budget}<br>Spent: ${spent}</p>`
        });
      } catch (mailErr) {
        console.error('Failed to send budget alert email:', mailErr.message);
      }
    }
  } catch (err) {
    console.error('Error checking budget:', err.message);
  }
}

module.exports = { checkBudget };
