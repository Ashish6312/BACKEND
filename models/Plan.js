const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  dailyIncome: { type: Number, required: true },
  planType: {
    type: String,
    enum: ['PlanA', 'Welfare'],
    required: true
  },
  image: {
    type: String,
    required: true
  },
  duration: { type: Number, required: true, default: 365 },
  yearlyIncome: { type: Number } // Only keep yearly income as calculated field
});

// Pre-save middleware to calculate yearly income
planSchema.pre('save', function(next) {
  this.duration = Math.max(1, this.duration || 365);
  this.yearlyIncome = this.dailyIncome * this.duration;
  next();
});

// Pre update middleware to handle updates
planSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update) {
    const duration = Math.max(1, update.duration || 365);
    update.yearlyIncome = update.dailyIncome * duration;
  }
  next();
});

module.exports = mongoose.model('Plan', planSchema);
