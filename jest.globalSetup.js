const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
  const mongoServer = await MongoMemoryServer.create();
  global.__MONGO_MEMORY_SERVER__ = mongoServer;
  process.env.MONGODB_URI = mongoServer.getUri();
};
