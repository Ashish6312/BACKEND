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
    type: String, // Can store image URL or file path
    required: true // Mark as required if every plan must have an image
  }
});

module.exports = mongoose.model('Plan', planSchema);
