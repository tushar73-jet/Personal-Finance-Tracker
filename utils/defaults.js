const pool = require('../db');

const createDefaultCategories = async (userId) => {
  const defaults = [
    { name: 'Salary', type: 'income', budget: 0 },
    { name: 'Gifts', type: 'income', budget: 0 },
    { name: 'Food', type: 'expense', budget: 500 },
    { name: 'Rent', type: 'expense', budget: 1500 },
    { name: 'Utilities', type: 'expense', budget: 200 },
    { name: 'Entertainment', type: 'expense', budget: 100 },
    { name: 'Shopping', type: 'expense', budget: 200 },
    { name: 'Transport', type: 'expense', budget: 150 },
    { name: 'Health', type: 'expense', budget: 100 },
    { name: 'Other', type: 'expense', budget: 0 },
  ];

  try {
    // Check if user already has categories
    const existing = await pool.query('SELECT id FROM categories WHERE user_id = $1 LIMIT 1', [userId]);
    if (existing.rows.length > 0) return;

    for (const cat of defaults) {
      await pool.query(
        'INSERT INTO categories (user_id, name, type, budget) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, name, type) DO NOTHING',
        [userId, cat.name, cat.type, cat.budget]
      );
    }
    console.log(`Created default categories for user ${userId}`);
  } catch (err) {
    console.error('Error creating default categories:', err.message);
  }
};

module.exports = { createDefaultCategories };
