const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  planName: { type: String, required: true },
  planType: { type: String, enum: ['PlanA', 'Welfare'], required: true },
  price: { type: Number, required: true },
  dailyIncome: { type: Number, required: true },
  purchaseDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  totalEarned: { type: Number, default: 0 }, // new: running total income
  lastIncomeDate: { type: Date }, // new: track last payout date
});

module.exports = mongoose.model('Purchase', purchaseSchema);
