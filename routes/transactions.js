const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');
const { checkBudget } = require('../utils/notifications');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

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
router.post('/', [authMiddleware, upload.single('receipt')], async (req, res) => {
  try {
    const { amount, currency, description, date, category_id } = req.body;
    const userId = req.user.user.id;

    // Validate date (no future dates)
    if (new Date(date) > new Date()) {
      return res.status(400).json({ error: 'Transaction date cannot be in the future.' });
    }

    const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate category belongs to user if category_id is provided
    if (category_id && category_id !== 'null') {
      const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [category_id, req.user.user.id]);
      if (category.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid category' });
      }
    }

    const newTransaction = await pool.query(
      'INSERT INTO transactions (user_id, category_id, amount, currency, description, date, receipt_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [req.user.user.id, (category_id && category_id !== 'null') ? category_id : null, amount, currency || 'USD', description, date, receipt_url]
    );

    res.status(201).json(newTransaction.rows[0]);

    // Check budget in background
    if (category_id && category_id !== 'null') {
      checkBudget(req.user.user.id, category_id);
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Update a transaction
router.put('/:id', [authMiddleware, upload.single('receipt')], async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, amount, description, date, currency } = req.body;
    const receipt_url = req.file ? `/uploads/${req.file.filename}` : undefined;

    const transaction = await pool.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.user.id]);
    if (transaction.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (category_id && category_id !== 'null') {
      const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [category_id, req.user.user.id]);
      if (category.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid category' });
      }
    }

    const updatedTransaction = await pool.query(
      `UPDATE transactions SET 
        category_id = COALESCE($1, category_id), 
        amount = COALESCE($2, amount), 
        currency = COALESCE($3, currency),
        description = COALESCE($4, description), 
        date = COALESCE($5, date),
        receipt_url = COALESCE($6, receipt_url)
       WHERE id = $7 AND user_id = $8 RETURNING *`,
      [(category_id && category_id !== 'null') ? category_id : null, amount, currency, description, date, receipt_url, id, req.user.user.id]
    );

    res.json(updatedTransaction.rows[0]);

    // Check budget in background
    if (category_id && category_id !== 'null') {
      checkBudget(req.user.user.id, category_id);
    } else if (transaction.rows[0].category_id) {
      checkBudget(req.user.user.id, transaction.rows[0].category_id);
    }
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

const csv = require('csv-parser');
const fs = require('fs');

// Import transactions from CSV
router.post('/import', [authMiddleware, upload.single('file')], async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const results = [];
  const filePath = req.file.path;
  const userId = req.user.user.id;

  try {
    // 1. Get all user categories for auto-categorization
    const categoriesResult = await pool.query('SELECT id, name, type FROM categories WHERE user_id = $1', [userId]);
    const categories = categoriesResult.rows;

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        let importedCount = 0;
        let duplicateCount = 0;

        for (const row of results) {
          // Expected columns: date, amount, description, currency (optional)
          const { date, amount, description, currency = 'USD' } = row;
          
          if (!date || !amount || !description) continue;

          // 2. Duplicate detection
          const duplicate = await pool.query(
            'SELECT id FROM transactions WHERE user_id = $1 AND date = $2 AND amount = $3 AND description = $4',
            [userId, date, amount, description]
          );

          if (duplicate.rows.length > 0) {
            duplicateCount++;
            continue;
          }

          // 3. Simple auto-categorization logic
          // Match description keywords to category names
          let categoryId = null;
          const descLower = description.toLowerCase();
          const match = categories.find(c => descLower.includes(c.name.toLowerCase()));
          if (match) categoryId = match.id;
          else {
            // Default to 'Other' or first expense category if not found
            const other = categories.find(c => c.name.toLowerCase() === 'other');
            categoryId = other ? other.id : (categories.find(c => c.type === 'expense')?.id || null);
          }

          // 4. Insert
          await pool.query(
            'INSERT INTO transactions (user_id, category_id, amount, currency, description, date) VALUES ($1, $2, $3, $4, $5, $6)',
            [userId, categoryId, amount, currency, description, date]
          );
          importedCount++;
        }

        fs.unlinkSync(filePath); // Clean up uploaded file
        res.json({ message: `Import complete. Imported: ${importedCount}, Duplicates skipped: ${duplicateCount}` });
      });
  } catch (err) {
    console.error('Import error:', err.message);
    res.status(500).send('Server Error during import');
  }
});

module.exports = router;
