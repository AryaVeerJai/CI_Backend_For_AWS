const jwt = require('jsonwebtoken');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET must be set');
  }
  return secret;
};

const signJwt = (payload, options = {}) => jwt.sign(payload, getJwtSecret(), options);

const verifyJwt = (token, options = {}) => jwt.verify(token, getJwtSecret(), options);

module.exports = {
  getJwtSecret,
  signJwt,
  verifyJwt
};
