const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

// Get all transactions for a user (with optional filtering)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const transactions = await pool.query(
      `SELECT t.*, c.name as category_name, c.type as category_type 
       FROM transactions t 
       LEFT JOIN categories c ON t.category_id = c.id 
       WHERE t.user_id = $1
       ORDER BY t.date DESC`,
      [req.user.user.id]
    );
    res.json(transactions.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Add a transaction
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { category_id, amount, description, date } = req.body;

    // Validate category belongs to user if category_id is provided
    if (category_id) {
      const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [category_id, req.user.user.id]);
      if (category.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid category' });
      }
    }

    const newTransaction = await pool.query(
      'INSERT INTO transactions (user_id, category_id, amount, description, date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.user.id, category_id || null, amount, description, date]
    );

    res.status(201).json(newTransaction.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Update a transaction
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, amount, description, date } = req.body;

    const transaction = await pool.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.user.id]);
    if (transaction.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (category_id) {
      const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [category_id, req.user.user.id]);
      if (category.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid category' });
      }
    }

    const updatedTransaction = await pool.query(
      `UPDATE transactions SET 
        category_id = COALESCE($1, category_id), 
        amount = COALESCE($2, amount), 
        description = COALESCE($3, description), 
        date = COALESCE($4, date) 
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [category_id, amount, description, date, id, req.user.user.id]
    );

    res.json(updatedTransaction.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Delete a transaction
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await pool.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.user.id]);
    if (transaction.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    await pool.query('DELETE FROM transactions WHERE id = $1', [id]);

    res.json({ message: 'Transaction deleted successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Dashboard metrics
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    // Total income, total expense, balance
    const totals = await pool.query(
      `SELECT 
         SUM(CASE WHEN c.type = 'income' THEN t.amount ELSE 0 END) as total_income,
         SUM(CASE WHEN c.type = 'expense' THEN t.amount ELSE 0 END) as total_expense
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1`,
      [req.user.user.id]
    );

    // Expenses by category
    const expensesByCategory = await pool.query(
      `SELECT c.name, c.budget, SUM(t.amount) as spent
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1 AND c.type = 'expense'
       GROUP BY c.id`,
      [req.user.user.id]
    );

    res.json({
      totals: totals.rows[0],
      expensesByCategory: expensesByCategory.rows,
      balance: (totals.rows[0].total_income || 0) - (totals.rows[0].total_expense || 0)
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
