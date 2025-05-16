const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['Recharge', 'Withdraw', 'Earning', 'Purchase', 'Other', 'ReferralBonus']
  },
  referralLevel: { type: Number }, // 1, 2, or 3 for referral bonuses
  amount: { type: Number, required: true },  status: { 
    type: String, 
    default: 'Success',
    enum: ['Pending', 'Success', 'Failed', 'Processing', 'Rejected']
  },
  date: { type: Date, default: Date.now },
  // Optional fields for better tracking
  description: { type: String },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  bankInfo: {
    realName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    ifscCode: { type: String, default: '' },
  }
});

module.exports = mongoose.model('Transaction', TransactionSchema);