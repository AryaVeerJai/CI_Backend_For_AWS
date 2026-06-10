const axios = require('axios');

const aiClient = axios.create({
  baseURL: process.env.AI_SERVICE_URL,
  timeout: Number(process.env.AI_REQUEST_TIMEOUT || 420000)
});

module.exports = aiClient;