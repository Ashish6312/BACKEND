const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true }, // Add username field
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  withdrawPassword: { type: String, required: true },
  wallet: { type: Number, default: 0 },
  inviteCode: { type: String, unique: true }, // Unique invite code for each user
  referredBy: { type: String, default: null }, // Invite code of the referrer
  referralChain: {
    level1: { type: String, default: null },
    level2: { type: String, default: null },
    level3: { type: String, default: null }
  },
  referralEarnings: {
    level1: { type: Number, default: 0 },
    level2: { type: Number, default: 0 },
    level3: { type: Number, default: 0 }
  },
  referralCounts: {
    level1: { type: Number, default: 0 },
    level2: { type: Number, default: 0 },
    level3: { type: Number, default: 0 }
  },
  bankInfo: {
    realName: { type: String, default: '' }, // Real name for bank account
    accountNumber: { type: String, default: '' },
    ifscCode: { type: String, default: '' },
  },
  team: [{
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    phone: { type: String },
    username: { type: String }, // Add username to team members
    level: { type: Number },
    joinedAt: { type: Date, default: Date.now }
  }]
});

const User = mongoose.model('User', userSchema);

module.exports = User;