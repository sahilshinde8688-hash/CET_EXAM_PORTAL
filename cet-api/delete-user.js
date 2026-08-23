require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');
const User = require('./models/User');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const email = 'sahilshindeupwork@gmail.com';

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const result = await User.findOneAndDelete({ email });
    if (!result) {
      console.log(`No user found with email: ${email}`);
    } else {
      console.log(`Deleted user with email: ${email}`);
    }
  } catch (err) {
    console.error('Error deleting user:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

run();
