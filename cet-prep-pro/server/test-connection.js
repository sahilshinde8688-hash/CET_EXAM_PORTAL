const { MongoClient } = require('mongodb');

// Original SRV connection string provided by user
const uri = 'mongodb+srv://sahilshinde8688_db_user:bU5C4VRDJdT4Jhbg@cluster0.tunytzw.mongodb.net/?appName=Cluster0';

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