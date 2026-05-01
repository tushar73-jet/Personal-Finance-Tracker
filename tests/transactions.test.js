const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const transactionRoutes = require('../routes/transactions');
const pool = require('../db');
const jwt = require('jsonwebtoken');

const app = express();
app.use(bodyParser.json());
app.use('/api/transactions', transactionRoutes);

describe('Transactions API', () => {
  jest.setTimeout(15000);
  let token;
  let userId;
  let testCategoryId;

  beforeAll(async () => {
    // 1. Create a test user and get token
    const userRes = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
      ['Test Tx User', `tx_test_${Date.now()}@example.com`, 'password']
    );
    userId = userRes.rows[0].id;
    token = jwt.sign({ user: { id: userId } }, process.env.JWT_SECRET || 'secret');

    // 2. Create a test category
    const catRes = await pool.query(
      'INSERT INTO categories (user_id, name, type) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'Test Food', 'expense']
    );
    testCategoryId = catRes.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  });

  it('should create a new transaction', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 50.00,
        currency: 'USD',
        description: 'Test Dinner',
        date: new Date().toISOString().split('T')[0],
        category_id: testCategoryId
      });
    
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('description', 'Test Dinner');
  });

  it('should get all transactions for user', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('should fail if date is in the future', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 10.00,
        currency: 'USD',
        description: 'Future Trip',
        date: '2029-01-01',
        category_id: testCategoryId
      });
    
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error', 'Transaction date cannot be in the future.');
  });
});
