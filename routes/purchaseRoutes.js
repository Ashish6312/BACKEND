const express = require('express');
const router = express.Router();
const creditDailyIncome = require('../creditDailyIncome'); // Import the function

// Route to trigger daily income crediting manually (you can trigger it periodically with a cron job)
router.get('/credit-daily-income', async (req, res) => {
  try {
    await creditDailyIncome();
    res.status(200).send('Daily income credited successfully');
  } catch (error) {
    res.status(500).send('Error crediting daily income');
  }
});

module.exports = router;
