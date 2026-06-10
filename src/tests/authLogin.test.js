const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const authRoutes = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const ADMIN_EMAIL = 'carbonintelligence@sustainow.in';
const ADMIN_PASSWORD = 'admin123';

describe('POST /api/auth/login (admin)', () => {
  beforeEach(async () => {
    await User.deleteMany({ email: ADMIN_EMAIL });
  });

  test('logs in admin created via User model (createAdmin script path)', async () => {
    await User.create({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      profile: { firstName: 'System', lastName: 'Administrator' },
      isActive: true,
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('admin');
    expect(response.body.data.token).toBeTruthy();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.data.token}`);

    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('admin');
  });

  test('logs in admin inserted with pre-hashed password (fixAdminUser script path)', async () => {
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.collection.insertOne({
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: 'admin',
      profile: { firstName: 'System', lastName: 'Administrator' },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('admin');
  });

  test('logs in admin with legacy plaintext password and upgrades hash', async () => {
    await User.collection.insertOne({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      profile: { firstName: 'System', lastName: 'Administrator' },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const admin = await User.findOne({ email: ADMIN_EMAIL });
    expect(admin.hasBcryptPassword()).toBe(true);
    expect(await admin.comparePassword(ADMIN_PASSWORD)).toBe(true);
  });

  test('matches admin email case-insensitively', async () => {
    await User.create({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      isActive: true,
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'CarbonIntelligence@Sustainow.IN',
        password: ADMIN_PASSWORD,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
