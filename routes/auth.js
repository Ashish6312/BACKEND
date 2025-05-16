const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const Purchase = require('../models/Purchase');
const lgPayService = require('../services/lgPayService');
dotenv.config();
const crypto = require('crypto');

// Get io instance from app
const getIO = (req) => req.app.get('io');

// Registration route
const generateInviteCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let inviteCode = '';
  for (let i = 0; i < 6; i++) {
    inviteCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return inviteCode;
};

router.post('/register', async (req, res) => {
  const { username, phone, password, withdrawPassword, referredBy } = req.body;

  try {
    // Check if the phone number is already registered
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ msg: 'Phone number is already registered' });
    }

    // Check if the username is already taken
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ msg: 'Username is already taken' });
    }

    // Generate a unique random invite code
    let inviteCode;
    let isUnique = false;

    while (!isUnique) {
      inviteCode = generateInviteCode();
      const existingCode = await User.findOne({ inviteCode });
      if (!existingCode) {
        isUnique = true;
      }
    }

    // Hash the passwords
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedWithdrawPassword = await bcrypt.hash(withdrawPassword, 10);

    // Create a new user
    const newUser = new User({
      username,
      phone,
      password: hashedPassword,
      withdrawPassword: hashedWithdrawPassword,
      inviteCode,
      referredBy: referredBy || null, // Optional invite code
    });    // If an invite code is provided, handle multi-level referrals
    if (referredBy) {
      // Level 1 (Direct Referrer)
      const level1Referrer = await User.findOne({ inviteCode: referredBy });
      if (!level1Referrer) {
        return res.status(400).json({ msg: 'Invalid invite code' });
      }

      // Set referral chain for new user
      newUser.referralChain.level1 = level1Referrer.inviteCode;
      newUser.referralChain.level2 = level1Referrer.referralChain.level1;
      newUser.referralChain.level3 = level1Referrer.referralChain.level2;

    // Process Level 1 Referral (₹50)
    level1Referrer.wallet += 50;
    level1Referrer.referralEarnings.level1 += 50;
    level1Referrer.referralCounts.level1 += 1;
    level1Referrer.team.push({
      _id: newUser._id,
      phone: newUser.phone,
      level: 1,
      joinedAt: new Date()
    });

    // Create transaction for Level 1
    const level1Transaction = new Transaction({
      phone: level1Referrer.phone,
      type: 'Referral Bonus',
      amount: 50,
      status: 'Success',
      description: `Level 1 referral bonus for inviting user ${newUser.username}`,
    });

    await level1Transaction.save();
    await level1Referrer.save();

    // Level 2 Referral (₹30)
    if (level1Referrer.referralChain.level1) {
      const level2Referrer = await User.findOne({ inviteCode: level1Referrer.referralChain.level1 });
      if (level2Referrer) {
        level2Referrer.wallet += 30;
        level2Referrer.referralEarnings.level2 += 30;
        level2Referrer.referralCounts.level2 += 1;
        level2Referrer.team.push({
          _id: newUser._id,
          phone: newUser.phone,
          level: 2,
          joinedAt: new Date()
        });

        // Create transaction for Level 2
        const level2Transaction = new Transaction({
          phone: level2Referrer.phone,
          type: 'Referral Bonus',
          amount: 30,
          status: 'Success',
          description: `Level 2 referral bonus from ${newUser.username}`,
        });

        await level2Transaction.save();
        await level2Referrer.save();

        // Level 3 Referral (₹20)
        if (level2Referrer.referralChain.level1) {
          const level3Referrer = await User.findOne({ inviteCode: level2Referrer.referralChain.level1 });
          if (level3Referrer) {
            level3Referrer.wallet += 20;
            level3Referrer.referralEarnings.level3 += 20;
            level3Referrer.referralCounts.level3 += 1;
            level3Referrer.team.push({
              _id: newUser._id,
              phone: newUser.phone,
              level: 3,
              joinedAt: new Date()
            });

            // Create transaction for Level 3
            const level3Transaction = new Transaction({
              phone: level3Referrer.phone,
              type: 'Referral Bonus',
              amount: 20,
              status: 'Success',
              description: `Level 3 referral bonus from ${newUser.username}`,
            });

            await level3Transaction.save();
            await level3Referrer.save();
          }
        }
      }
    }
    
    // Notify the user about the successful referral if you're using Socket.IO
    const io = getIO(req);
    if (io) {
      io.emit(`user:${inviter._id}:notification`, {
        type: 'referral',
        message: `You earned ₹${referralBonus} for referring ${newUser.username}!`,
      });
    }
    }

    // Save the new user
    await newUser.save();

    res.status(201).json({ msg: 'Registration successful', inviteCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Updated wallet recharge callback route to include invite rewards
router.post('/transaction/recharge/callback', async (req, res) => {
  const { order_sn, status, money, remark: phone } = req.body;
  // Verify signature
  if (!lgPayService.verifyCallback(req.body)) {
    return res.status(400).json({ msg: "Invalid payment signature" });
  }

  if (status !== 'SUCCESS') {
    return res.status(400).json({ msg: "Payment was not successful" });
  }

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const amount = parseFloat(money) / 100; // Convert from smallest currency unit (paise to rupees)
    user.wallet += amount; // Add the converted amount to wallet
    await user.save();

    // Distribute invite rewards based on recharge amount
    const referralChain = user.referralChain || {};
    const level1InviteCode = referralChain.level1;
    const level2InviteCode = referralChain.level2;
    const level3InviteCode = referralChain.level3;

    // Referral reward percentages for new logic
    const REFERRAL_REWARD_PERCENT = {
      level1: 0.25, // 25%
      level2: 0.03, // 3%
      level3: 0.02  // 2%
    };

    // Helper function to process reward for a level
    async function processReward(level, inviteCode, percent) {
      if (!inviteCode) return;
      const referrer = await User.findOne({ inviteCode });
      if (!referrer) return;

      // Only reward if user has recharged after account creation
      if (parseFloat(amount) > 0) {
        const rewardAmount = parseFloat(amount) * percent;
        referrer.wallet += rewardAmount;
        if (!referrer.referralEarnings) referrer.referralEarnings = {};
        if (!referrer.referralEarnings[`level${level}`]) referrer.referralEarnings[`level${level}`] = 0;
        referrer.referralEarnings[`level${level}`] += rewardAmount;
        if (!referrer.referralCounts) referrer.referralCounts = {};
        if (!referrer.referralCounts[`level${level}`]) referrer.referralCounts[`level${level}`] = 0;
        referrer.referralCounts[`level${level}`] += 1;
        referrer.team.push({
          _id: user._id,
          phone: user.phone,
          level: level,
          joinedAt: new Date()
        });
        const transaction = new Transaction({
          phone: referrer.phone,
          type: 'Referral Bonus',
          amount: rewardAmount,
          status: 'Success',
          description: `Level ${level} referral bonus from wallet recharge of user ${user.username}`,
        });
        await transaction.save();
        await referrer.save();
      }
    }

    await processReward(1, level1InviteCode, level1Percent);
    await processReward(2, level2InviteCode, level2Percent);
    await processReward(3, level3InviteCode, level3Percent);

    const transaction = new Transaction({
      phone,
      type: 'Recharge',
      amount: amount,
      status: 'Success',
      description: `Wallet recharged with ₹${amount} via LG Pay.`,
    });
    await transaction.save();

    // Emit socket event for real-time wallet update
    const io = getIO(req);
    io.emit('paymentComplete', {
      phone: user.phone,
      wallet: user.wallet,
      amount: amount
    });

    res.status(200).json({ msg: "Recharge successful", wallet: user.wallet });
  } catch (err) {
    console.error('Error in payment verification:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Updated wallet recharge route to include invite rewards
router.post('/transaction/recharge', async (req, res) => {
  const { phone, amount, transactionPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    user.wallet += parseFloat(amount);
    await user.save();

    // Distribute invite rewards based on recharge amount
    const referralChain = user.referralChain || {};
    const level1InviteCode = referralChain.level1;
    const level2InviteCode = referralChain.level2;
    const level3InviteCode = referralChain.level3;

    // Referral reward percentages for new logic
    const REFERRAL_REWARD_PERCENT = {
      level1: 0.25, // 25%
      level2: 0.03, // 3%
      level3: 0.02  // 2%
    };

    async function processReward(level, inviteCode, percent) {
      if (!inviteCode) return;
      const referrer = await User.findOne({ inviteCode });
      if (!referrer) return;

      // Only reward if user has recharged after account creation
      if (parseFloat(amount) > 0) {
        const rewardAmount = parseFloat(amount) * percent;
        referrer.wallet += rewardAmount;
        if (!referrer.referralEarnings) referrer.referralEarnings = {};
        if (!referrer.referralEarnings[`level${level}`]) referrer.referralEarnings[`level${level}`] = 0;
        referrer.referralEarnings[`level${level}`] += rewardAmount;
        if (!referrer.referralCounts) referrer.referralCounts = {};
        if (!referrer.referralCounts[`level${level}`]) referrer.referralCounts[`level${level}`] = 0;
        referrer.referralCounts[`level${level}`] += 1;
        referrer.team.push({
          _id: user._id,
          phone: user.phone,
          level: level,
          joinedAt: new Date()
        });
        const transaction = new Transaction({
          phone: referrer.phone,
          type: 'Referral Bonus',
          amount: rewardAmount,
          status: 'Success',
          description: `Level ${level} referral bonus from wallet recharge of user ${user.username}`,
        });
        await transaction.save();
        await referrer.save();
      }
    }

    await processReward(1, level1InviteCode, level1Percent);
    await processReward(2, level2InviteCode, level2Percent);
    await processReward(3, level3InviteCode, level3Percent);

    const transaction = new Transaction({
      phone,
      type: 'Recharge',
      amount: parseFloat(amount),
      status: 'Success',
      description: `Wallet recharged with ₹${amount}. Thank you for using our service!`,
    });

    await transaction.save();

    res.status(200).json({ msg: 'Recharge successful', wallet: user.wallet });
  } catch (err) {
    console.error('Error processing recharge:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find the user by username
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ msg: 'User not found' });

    // Compare the provided password with the stored hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid password' });

    // Generate a JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    // Send the user data and token in the response
    res.status(200).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        wallet: user.wallet,
        inviteCode: user.inviteCode,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/auth/create-order
router.post('/create-order', async (req, res) => {
  const { amount, phone } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const result = await lgPayService.createOrder(amount, phone, clientIp);
    if (result.success) {
      res.status(200).json({
        orderId: result.orderId,
        payUrl: result.payUrl
      });
    } else {
      throw new Error('Failed to create payment order');
    }
  } catch (error) {
    console.error("❌ LG Pay Error:", error);
    res.status(500).json({ msg: "Payment order creation failed", error: error.message });
  }
});

// POST /api/auth/transaction/recharge/callback
router.post('/transaction/recharge/callback', async (req, res) => {
  const { order_sn, status, money, remark: phone } = req.body;
  // Verify signature
  if (!lgPayService.verifyCallback(req.body)) {
    return res.status(400).json({ msg: "Invalid payment signature" });
  }

  if (status !== 'SUCCESS') {
    return res.status(400).json({ msg: "Payment was not successful" });
  }

  // Process the successful payment
  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const amount = parseFloat(money) / 100; // Convert from smallest currency unit (paise to rupees)
    user.wallet += amount; // Add the converted amount to wallet
    await user.save();
    
    const transaction = new Transaction({
      phone,
      type: 'Recharge',
      amount: amount,
      status: 'Success',
      description: `Wallet recharged with ₹${amount} via LG Pay.`,
    });
    await transaction.save();

    // Emit socket event for real-time wallet update
    const io = getIO(req);
    io.emit('paymentComplete', {
      phone: user.phone,
      wallet: user.wallet,
      amount: amount
    });

    res.status(200).json({ msg: "Recharge successful", wallet: user.wallet });
  } catch (err) {
    console.error('Error in payment verification:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});
router.post('/check-username', async (req, res) => {
  const { username } = req.body;

  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return res.status(400).json({ msg: 'Username is already taken' });
  }

  res.status(200).json({ msg: 'Username is available' });
});

// POST /api/transaction/recharge
router.post('/transaction/recharge', async (req, res) => {
  const { phone, amount, transactionPassword } = req.body;

  try {
    // Find the user
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Verify the transaction password
    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    // Update the user's wallet
    user.wallet += parseFloat(amount);
    await user.save();

      // Save the transaction
  // Save the transaction
  const transaction = new Transaction({
    phone,
    type: 'Recharge',
    amount: parseFloat(amount),
    status: 'Success',
    description: `Wallet recharged with ₹${amount}. Thank you for using our service!`,
  });


    await transaction.save();

    res.status(200).json({ msg: 'Recharge successful', wallet: user.wallet });
  } catch (err) {
    console.error('Error processing recharge:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// POST /api/transaction/withdraw
router.post('/transaction/withdraw', async (req, res) => {
  const { phone, amount, transactionPassword, bankInfo } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    const withdrawalAmount = parseFloat(amount);
    const finalAmount = withdrawalAmount * 0.9;

    if (user.wallet < withdrawalAmount) {
      return res.status(400).json({ msg: 'Insufficient balance' });
    }

    user.wallet -= withdrawalAmount;
    await user.save();

    // Use bankInfo from request if provided, else fallback to user's bankInfo
    const transaction = new Transaction({
      phone,
      type: 'Withdraw',
      amount: withdrawalAmount,
      status: 'Processing',
      finalAmount: finalAmount,
      description: `Withdrawal of ₹${withdrawalAmount} requested. ₹${finalAmount.toFixed(2)} will be received after 10% processing fee.`,
      bankInfo: bankInfo || {
        realName: user.bankInfo?.realName || '',
        accountNumber: user.bankInfo?.accountNumber || '',
        ifscCode: user.bankInfo?.ifscCode || ''
      }
    });

    await transaction.save();

    res.status(200).json({ msg: 'Withdrawal request submitted successfully', wallet: user.wallet });
  } catch (err) {
    console.error('Error during withdraw:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// POST /api/transaction/buy-plan
router.post('/transaction/buy-plan', async (req, res) => {
  const { phone, planId, planPrice } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    if (user.wallet < planPrice) {
      return res.status(400).json({ msg: 'Insufficient balance' });
    }

    user.wallet -= planPrice;
    // Here, you can also save the plan purchase in the user's history if needed.
    await user.save();

    res.json({ msg: 'Plan purchased successfully', wallet: user.wallet });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});
// POST /api/profile/bank-info
router.post('/profile/update-bank', async (req, res) => {
  const { phone, accountNumber, ifscCode, realName } = req.body;

  try {
    // Check if account number is already used by another user
    const existing = await User.findOne({ 'bankInfo.accountNumber': accountNumber });
    if (existing && existing.phone !== phone) {
      return res.status(400).json({ msg: 'Bank account already in use by another user' });
    }

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    user.bankInfo = { accountNumber, ifscCode, realName };
    await user.save();

    res.json({ msg: 'Bank info updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});
router.post('/profile/change-login-password', async (req, res) => {
  const { phone, oldPassword, newPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password); // Use bcrypt to compare passwords
    if (!isMatch) {
      return res.status(400).json({ msg: 'Old password incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10); // Hash the new password
    user.password = hashedNewPassword;
    await user.save();

    res.json({ msg: 'Login password updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});
router.post('/profile/change-withdraw-password', async (req, res) => {
  const { phone, oldWithdrawPassword, newWithdrawPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const isMatch = await bcrypt.compare(oldWithdrawPassword, user.withdrawPassword); // Use bcrypt to compare passwords
    if (!isMatch) {
      return res.status(400).json({ msg: 'Old withdraw password incorrect' });
    }

    const hashedNewWithdrawPassword = await bcrypt.hash(newWithdrawPassword, 10); // Hash the new withdraw password
    user.withdrawPassword = hashedNewWithdrawPassword;
    await user.save();

    res.json({ msg: 'Withdraw password updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/profile/referrals/:inviteCode', async (req, res) => {
  const { inviteCode } = req.params;

  try {
    // Find the referrer user by inviteCode
    const referrer = await User.findOne({ inviteCode });
    if (!referrer) return res.status(404).json({ msg: 'Referrer not found' });

    // Manually populate team members with more details
    const populatedTeam = await Promise.all(
      referrer.team.map(async (member) => {
        const userDetails = await User.findById(member._id);
        return {
          _id: userDetails._id,
          phone: userDetails.phone,
          username: userDetails.username,
          joinedAt: userDetails.createdAt,
        };
      })
    );

    // Calculate referral statistics
    const totalReferrals = populatedTeam.length;
    const referralEarnings = referrer.referralEarnings || 0;

    // Return populated team with stats
    res.status(200).json({ 
      referrals: populatedTeam,
      stats: {
        totalReferrals,
        referralEarnings
      }
    });
  } catch (err) {
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Add a route to get referral earnings
router.get('/profile/referral-earnings/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Get all transactions related to referrals
    const referralTransactions = await Transaction.find({
      phone: user.phone,
      type: 'Referral Bonus'
    }).sort({ date: -1 });

    res.status(200).json({
      totalEarnings: user.referralEarnings || 0,
      transactions: referralTransactions
    });
  } catch (err) {
    console.error('Error fetching referral earnings:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});


// Route to fetch transaction history
router.get('/transactions/:phone', async (req, res) => {
  const { phone } = req.params;

  try {
    const transactions = await Transaction.find({ phone }).sort({ date: -1 });

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ msg: 'No transactions found' });
    }

    res.status(200).json({ transactions });
  } catch (err) {
    console.error('Error fetching transactions:', err.message); // Log the error
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Route to validate transaction password
router.post('/validate-transaction-password', async (req, res) => {
  const { phone, transactionPassword } = req.body;

  try {
    // Find the user by phone
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Compare the provided password with the hashed password
    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    res.status(200).json({ msg: 'Transaction password is valid' });
  } catch (err) {
    console.error('Error validating transaction password:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Admin login route
// In routes/auth.js
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Verify admin credentials
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ msg: 'Invalid credentials' });
  }
  
  // Create token with admin role
  const token = jwt.sign(
    { username, role: 'admin' }, // Must include role: 'admin'
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  console.log('Generated token:', { token, payload: { username, role: 'admin' } });
  
  res.json({ token });
});

// GET /api/user/investments/:userId
router.get('/investments/:userId', async (req, res) => {
  console.log('Fetching investments for user:', req.params.userId);

  try {
    const purchases = await Purchase.find({ userId: req.params.userId, status: 'active' }).populate('planId');
    
    // Check if purchases exist for the user
    if (!purchases || purchases.length === 0) {
      return res.status(404).json({ error: 'No active investments found' });
    }

    const today = new Date();

    const investmentData = purchases.map(purchase => {
      const daysPassed = Math.floor((today - new Date(purchase.purchaseDate)) / (1000 * 60 * 60 * 24));
      const incomeTillNow = daysPassed * purchase.dailyIncome;

      return {
        planName: purchase.planName,
        planType: purchase.planType,
        investedAmount: purchase.price,
        dailyIncome: purchase.dailyIncome,
        totalEarned: incomeTillNow,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
      };
    });

    res.json(investmentData);
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({ error: 'Failed to fetch investments' });
  }
});

// Add this new route to your auth.js file

// Add this new route to your auth.js file
// GET /api/auth/user/:id - Get user by ID
router.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Return user data without sensitive information
    res.json({
      id: user._id,
      username: user.username,
      phone: user.phone,
      wallet: user.wallet,
      inviteCode: user.inviteCode
    });
  } catch (err) {
    console.error('Error fetching user data:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Admin route to get all pending withdrawals
router.get('/admin/withdrawals', async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ 
      type: 'Withdraw',
      status: 'Processing'
    }).sort({ date: -1 });

    res.json(withdrawals);
  } catch (err) {
    console.error('Error fetching withdrawals:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Admin route to get successful withdrawals
router.get('/admin/withdrawals/successful', async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ 
      type: 'Withdraw',
      status: 'Success'
    }).sort({ date: -1 });

    res.json(withdrawals);
  } catch (err) {
    console.error('Error fetching successful withdrawals:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Admin route to approve/reject withdrawals
router.post('/admin/withdrawal/:transactionId/update-status', async (req, res) => {
  const { transactionId } = req.params;
  const { status, remarks } = req.body;

  try {
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ msg: 'Transaction not found' });
    }

    if (transaction.type !== 'Withdraw') {
      return res.status(400).json({ msg: 'Invalid transaction type' });
    }    // Update the transaction status
    transaction.status = status === 'Approved' ? 'Success' : status;
    if (remarks) {
      transaction.description += ` Admin remarks: ${remarks}`;
    }
    await transaction.save();

    // If the withdrawal is rejected, refund the amount to user's wallet
    if (status === 'Rejected') {
      const user = await User.findOne({ phone: transaction.phone });
      if (user) {
        user.wallet += transaction.amount;
        await user.save();
        
        // Emit socket event for real-time wallet update
        const io = getIO(req);
        if (io) {
          io.emit('walletUpdated', {
            userId: user._id,
            newWallet: user.wallet,
            amount: transaction.amount,
            transactionType: 'Refund'
          });
        }
      }
    }

    res.json({ msg: `Withdrawal ${status.toLowerCase()}`, transaction });
  } catch (err) {
    console.error('Error updating withdrawal status:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get all users (for referral calculations)
router.get('/all-users', async (req, res) => {
  try {
    const users = await User.find({}, { phone: 1, createdAt: 1, _id: 1 });
    res.status(200).json({ users });
  } catch (err) {
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

module.exports = router;