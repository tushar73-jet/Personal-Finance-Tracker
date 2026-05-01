require('dotenv').config();
const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

console.log('AI Route: Initializing with Groq Key status:', process.env.GROQ_API_KEY ? 'Present' : 'MISSING');

let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

router.post('/analyze', authMiddleware, async (req, res) => {
  if (!groq) return res.status(500).json({ error: 'AI features are not configured. Please add GROQ_API_KEY to your environment variables.' });
  try {
    // 1. Fetch user's recent transactions
    const transactions = await pool.query(
      `SELECT t.amount, t.currency, t.description, t.date, c.name as category, c.type
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1
       ORDER BY t.date DESC
       LIMIT 50`,
      [req.user.user.id]
    );

    if (transactions.rows.length === 0) {
      return res.json({ analysis: "You don't have any transactions yet. Start adding some to get AI insights!" });
    }

    // 2. Prepare data for Groq
    const txData = transactions.rows.map(t => 
      `${t.date}: ${t.type === 'expense' ? '-' : '+'}${t.currency}${t.amount} (${t.description}) [${t.category}]`
    ).join('\n');

    // 3. Call Groq API
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful and professional financial advisor. Analyze the user's recent transactions and provide 3 concise, actionable insights or tips to improve their financial health. Be encouraging but direct."
        },
        {
          role: "user",
          content: `Here are my recent transactions:\n${txData}\n\nPlease provide a short summary and 3 tips.`
        }
      ],
      model: "llama3-8b-8192",
    });

    res.json({ analysis: chatCompletion.choices[0].message.content });
  } catch (err) {
    console.error('Groq API Error:', err.message);
    res.status(500).json({ error: 'AI Analysis failed. Please check your API key.' });
  }
});

module.exports = router;
