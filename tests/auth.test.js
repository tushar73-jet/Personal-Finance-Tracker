const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const authRoutes = require('../routes/auth');
const pool = require('../db');

const app = express();
app.use(bodyParser.json());
app.use('/api/auth', authRoutes);

describe('Auth API', () => {
  jest.setTimeout(15000); // 15 seconds for slow cloud DB
  let testUserEmail = `test_${Date.now()}@example.com`;

  afterAll(async () => {
    // Cleanup test user
    await pool.query('DELETE FROM users WHERE email = $1', [testUserEmail]);
    await pool.end();
  });

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: testUserEmail,
        password: 'password123'
      });
    
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('email', testUserEmail);
  });

  it('should login an existing user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUserEmail,
        password: 'password123'
      });
    
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('token');
  });

  it('should fail to login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUserEmail,
        password: 'wrongpassword'
      });
    
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error', 'Invalid Credentials');
  });
});
