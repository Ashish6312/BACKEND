const express = require('express');
const router = express.Router();
const Investment = require('../models/Investment');

// CREATE a new investment
router.post('/create', async (req, res) => {
  try {
    const { userId, planId, planName, planType, investedAmount, dailyIncome, durationDays } = req.body;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + durationDays);

    const newInvestment = new Investment({
      userId,
      planId,
      planName,
      planType,
      investedAmount,
      dailyIncome,
      durationDays,
      startDate,
      endDate,
    });

    await newInvestment.save();
    res.status(201).json({ success: true, investment: newInvestment });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET all investments for a user
// Backend route example
app.get('/api/investments/user/:userId', async (req, res) => {
    try {
      const userId = req.params.userId;
      const investments = await Investment.find({ userId }); // Assuming 'userId' is the foreign key in the Investment model
      res.json({ investments });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error fetching investments' });
    }
  });
  

module.exports = router;
