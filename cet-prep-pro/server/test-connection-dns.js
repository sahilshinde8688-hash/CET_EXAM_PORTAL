const dns = require('dns');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../cet-api/.env') });

// Use Google's DNS servers (8.8.8.8, 8.8.4.4) to resolve MongoDB hostnames
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4']);

const uri = process.env.MONGO_URI;

// Monkey-patch the default DNS resolution to use Google's DNS
const originalLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }
  
  resolver.resolve(hostname, (err, addresses) => {
    if (err) {
      // Fallback to original lookup
      return originalLookup(hostname, options, callback);
    }
    
    // Return first address
    const addr = addresses[0];
    callback(null, addr, addr.includes(':') ? 6 : 4);
  });
};

const client = new MongoClient(uri, {
  serverApi: {
    version: '1',
    strict: true,
    deprecationErrors: true,
  },
});

async function testConnection() {
  try {
    console.log('Attempting to connect to MongoDB...');
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
    console.error('Full error:', error);
    process.exit(1);
  }
}

testConnection();