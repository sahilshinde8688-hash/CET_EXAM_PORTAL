require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');
const User = require('./models/User');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const emails = ['sahilshinde8688@gmail.com', 'sahilshindeupwork@gmail.com'];

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    for (const email of emails) {
      const user = await User.findOne({ email });
      if (!user) {
        console.log(`${email}: not found`);
      } else {
        console.log(`${email}: found, status=${user.status}, role=${user.role}, mhcetId=${user.mhcetId || 'none'}`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

run();
