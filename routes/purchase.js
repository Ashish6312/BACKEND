const express = require('express');
const router = express.Router();
const Purchase = require('../models/Purchase');
const Plan = require('../models/Plan');
const User = require('../models/User');
const Transaction = require('../models/Transaction'); // Import Transaction model

router.post('/', async (req, res) => {
  const { userId, planId } = req.body;

  try {
    // Fetch the plan details
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ msg: 'Plan not found' });

    // Fetch the user details
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Check if the user has enough balance
    if (user.wallet < plan.price) {
      return res.status(400).json({ msg: 'Insufficient wallet balance' });
    }

    // Deduct the plan price from the user's wallet
    user.wallet -= plan.price;
    await user.save();

    // Create a new purchase, include planType here
    const newPurchase = new Purchase({
      userId,
      planId,
      planName: plan.name,
      planType: plan.planType, // Include the planType field
      price: plan.price,
      dailyIncome: plan.dailyIncome,
    });

    await newPurchase.save();

    // Create a transaction record for this purchase
    const purchaseTransaction = new Transaction({
      phone: user.phone,
      userId: user._id,
      type: 'Purchase',
      amount: plan.price,
      status: 'Success',
      date: new Date(),
      description: `Purchase of ${plan.name}`,
      planId: plan._id,
      purchaseId: newPurchase._id
    });

    await purchaseTransaction.save();

    // Get the io instance and emit wallet update
    const io = req.app.get('io');
    if (io) {
      io.emit('walletUpdated', {
        userId: user._id.toString(),
        newWallet: user.wallet,
        amount: -plan.price // Negative to indicate deduction
      });
    }

    res.status(201).json({
      msg: 'Plan purchased successfully',
      purchase: newPurchase,
      updatedWallet: user.wallet,
    });

  } catch (err) {
    console.error('Failed to purchase plan:', err);
    res.status(500).json({ msg: 'Failed to purchase plan', error: err.message });
  }
});

module.exports = router;
