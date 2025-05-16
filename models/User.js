const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true }, // Add username field
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  withdrawPassword: { type: String, required: true },
  wallet: { type: Number, default: 0 },
  inviteCode: { type: String, unique: true }, // Unique invite code for each user
  referredBy: { type: String, default: null }, // Invite code of the referrer
  bankInfo: {
    realName: { type: String, default: '' }, // Real name for bank account
    accountNumber: { type: String, default: '' },
    ifscCode: { type: String, default: '' },
  },
  team: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      phone: { type: String },
    },
  ], // Store both _id and phone of referred users
});

module.exports = mongoose.model('User', userSchema);