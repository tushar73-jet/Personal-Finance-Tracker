const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');
const { createDefaultCategories } = require('../utils/defaults');

// Get all categories for a user
router.get('/', authMiddleware, async (req, res) => {
  try {
    let categories = await pool.query(
      'SELECT * FROM categories WHERE user_id = $1',
      [req.user.user.id]
    );

    // If no categories, initialize defaults and re-fetch
    if (categories.rows.length === 0) {
      await createDefaultCategories(req.user.user.id);
      categories = await pool.query(
        'SELECT * FROM categories WHERE user_id = $1',
        [req.user.user.id]
      );
    }

    res.json(categories.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Create a category
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, type, budget } = req.body;
    
    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ error: 'Type must be income or expense' });
    }

    const newCategory = await pool.query(
      'INSERT INTO categories (user_id, name, type, budget) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.user.id, name, type, budget || 0]
    );

    res.status(201).json(newCategory.rows[0]);
  } catch (err) {
    console.error(err.message);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Category with this name and type already exists' });
    }
    res.status(500).send('Server Error');
  }
});

// Update a category (e.g. update budget)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, budget } = req.body;

    const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [id, req.user.user.id]);
    if (category.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const updatedCategory = await pool.query(
      'UPDATE categories SET name = COALESCE($1, name), budget = COALESCE($2, budget) WHERE id = $3 AND user_id = $4 RETURNING *',
      [name, budget, id, req.user.user.id]
    );

    res.json(updatedCategory.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Delete a category
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const category = await pool.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [id, req.user.user.id]);
    if (category.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await pool.query('DELETE FROM categories WHERE id = $1', [id]);

    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
