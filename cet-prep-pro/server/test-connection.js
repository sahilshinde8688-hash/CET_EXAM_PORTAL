const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../cet-api/.env') });

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: '1',
    strict: true,
    deprecationErrors: true,
  },
});

async function testConnection() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB!');
    
    const db = client.db('cetprep');
    console.log('Database:', db.databaseName);
    
    // Run ping command
    await db.command({ ping: 1 });
    console.log('✅ Pinged the deployment. You successfully connected to MongoDB!');
    
    // List collections
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    await client.close();
    console.log('Connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();