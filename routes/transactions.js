const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');
const { checkBudget } = require('../utils/notifications');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
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

    // Validate category (Mandatory for production tracking)
    if (!category_id || category_id === 'null' || category_id === '') {
      return res.status(400).json({ error: 'Please select a category to track this transaction correctly.' });
    }

    const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [category_id, req.user.user.id]);
    if (category.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const newTransaction = await pool.query(
      'INSERT INTO transactions (user_id, category_id, amount, currency, description, date, receipt_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [req.user.user.id, category_id, amount, currency || 'USD', description, date, receipt_url]
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
const pdf = require('pdf-parse');
const Groq = require('groq-sdk');

let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// Import transactions from CSV or PDF
router.post('/import', [authMiddleware, upload.single('file')], async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const userId = req.user.user.id;
  let transactionsToProcess = [];

  try {
    const categoriesResult = await pool.query('SELECT id, name, type FROM categories WHERE user_id = $1', [userId]);
    const categories = categoriesResult.rows;

    if (req.file.mimetype === 'application/pdf') {
      if (!groq) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(500).json({ error: 'AI features are not configured. Please add GROQ_API_KEY to your environment variables.' });
      }
      
      // PDF Processing with AI
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      const rawText = pdfData.text;

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a specialized financial data extractor. Extract transaction details (date, amount, description, currency) from bank statement text. Return ONLY a JSON array of objects. Example: [{\"date\":\"2024-01-01\",\"amount\":100,\"description\":\"Salary\",\"currency\":\"USD\"}]. If amount is an expense, keep it positive. Use YYYY-MM-DD for dates."
          },
          {
            role: "user",
            content: `Extract transactions from this text:\n${rawText.substring(0, 4000)}` // Limit text for token limits
          }
        ],
        model: "llama-3.1-8b-instant",
        response_format: { type: "json_object" } // Using JSON mode if supported or just parsing
      });

      // Simple parsing of AI response (handle potential JSON wrapping)
      let aiContent = chatCompletion.choices[0].message.content;
      try {
        const parsed = JSON.parse(aiContent);
        transactionsToProcess = Array.isArray(parsed) ? parsed : (parsed.transactions || []);
      } catch (e) {
        console.error('AI JSON Parse Error:', e);
        // Fallback or error
      }
    } else {
      // CSV Processing (Existing logic)
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => transactionsToProcess.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
    }

    let importedCount = 0;
    let duplicateCount = 0;

    for (const tx of transactionsToProcess) {
      const { date, amount, description, currency = 'USD' } = tx;
      if (!date || !amount || !description) continue;

      const duplicate = await pool.query(
        'SELECT id FROM transactions WHERE user_id = $1 AND date = $2 AND amount = $3 AND description = $4',
        [userId, date, amount, description]
      );

      if (duplicate.rows.length > 0) {
        duplicateCount++;
        continue;
      }

      let categoryId = null;
      const descLower = description.toLowerCase();
      const match = categories.find(c => descLower.includes(c.name.toLowerCase()));
      if (match) categoryId = match.id;
      else {
        const other = categories.find(c => c.name.toLowerCase() === 'other');
        categoryId = other ? other.id : (categories.find(c => c.type === 'expense')?.id || null);
      }

      await pool.query(
        'INSERT INTO transactions (user_id, category_id, amount, currency, description, date) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, categoryId, amount, currency, description, date]
      );
      importedCount++;
    }

    fs.unlinkSync(filePath);
    res.json({ message: `Import complete. Imported: ${importedCount}, Duplicates skipped: ${duplicateCount}` });

  } catch (err) {
    console.error('Import error:', err.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

module.exports = router;
