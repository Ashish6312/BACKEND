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

// Get the Socket.IO instance from the Express app
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
    console.log(`Registration attempt: ${username}, ${phone}, referredBy: ${referredBy}`);
    
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
      referredBy: referredBy || null,
      referralChain: {
        level1: null,
        level2: null,
        level3: null
      },
      referralEarnings: {
        level1: 0,
        level2: 0,
        level3: 0
      },
      referralCounts: {
        level1: 0,
        level2: 0,
        level3: 0
      },
      team: []
    });

    // If an invite code is provided, handle multi-level referrals
    if (referredBy) {
      console.log(`Processing referral: ${referredBy}`);
      
      // Level 1 (Direct Referrer)
      const level1Referrer = await User.findOne({ inviteCode: referredBy });
      if (!level1Referrer) {
        console.log('Invalid invite code');
        return res.status(400).json({ msg: 'Invalid invite code' });
      }
      
      console.log(`Found level1 referrer: ${level1Referrer.username}`);

      // Set referral chain for new user
      newUser.referralChain.level1 = level1Referrer.inviteCode;
      
      if (level1Referrer.referralChain && level1Referrer.referralChain.level1) {
        newUser.referralChain.level2 = level1Referrer.referralChain.level1;
      }
      
      if (level1Referrer.referralChain && level1Referrer.referralChain.level2) {
        newUser.referralChain.level3 = level1Referrer.referralChain.level2;
      }

      // Save the new user first to get its _id
      await newUser.save();
      console.log(`New user saved with ID: ${newUser._id}`);

      // Add the new user to level1Referrer's team
      if (!level1Referrer.team) {
        level1Referrer.team = [];
      }
      
      level1Referrer.team.push({
        _id: newUser._id,
        phone: newUser.phone,
        username: newUser.username,
        level: 1,
        joinedAt: new Date()
      });
      
      console.log(`Added user to level1 referrer's team. Team size now: ${level1Referrer.team.length}`);
      await level1Referrer.save();

      // Add the new user to level2Referrer's team if exists
      if (newUser.referralChain.level2) {
        const level2Referrer = await User.findOne({ inviteCode: newUser.referralChain.level2 });
        if (level2Referrer) {
          console.log(`Found level2 referrer: ${level2Referrer.username}`);
          
          if (!level2Referrer.team) {
            level2Referrer.team = [];
          }
          
          level2Referrer.team.push({
            _id: newUser._id,
            phone: newUser.phone,
            username: newUser.username,
            level: 2,
            joinedAt: new Date()
          });
          
          console.log(`Added user to level2 referrer's team. Team size now: ${level2Referrer.team.length}`);
          await level2Referrer.save();
        }
      }

      // Add the new user to level3Referrer's team if exists
      if (newUser.referralChain.level3) {
        const level3Referrer = await User.findOne({ inviteCode: newUser.referralChain.level3 });
        if (level3Referrer) {
          console.log(`Found level3 referrer: ${level3Referrer.username}`);
          
          if (!level3Referrer.team) {
            level3Referrer.team = [];
          }
          
          level3Referrer.team.push({
            _id: newUser._id,
            phone: newUser.phone,
            username: newUser.username,
            level: 3,
            joinedAt: new Date()
          });
          
          console.log(`Added user to level3 referrer's team. Team size now: ${level3Referrer.team.length}`);
          await level3Referrer.save();
        }
      }
    } else {
      // If no referral, just save the new user
      await newUser.save();
      console.log(`New user saved with ID: ${newUser._id} (no referral)`);
    }

    res.status(201).json({ msg: 'Registration successful', inviteCode });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// --- Referral reward helper ---
async function distributeReferralRewards({ user, amount, req }) {
  const referralChain = user.referralChain || {};
  const level1InviteCode = referralChain.level1;
  const level2InviteCode = referralChain.level2;
  const level3InviteCode = referralChain.level3;

  // Referral reward percentages
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

    // Calculate reward based on recharge amount
    const rewardAmount = amount * percent;
    referrer.wallet += rewardAmount;
    if (!referrer.referralEarnings) {
      referrer.referralEarnings = { level1: 0, level2: 0, level3: 0 };
    }
    if (!referrer.referralEarnings[`level${level}`]) {
      referrer.referralEarnings[`level${level}`] = 0;
    }
    referrer.referralEarnings[`level${level}`] += rewardAmount;

    // Create transaction record for the referral bonus
    const transaction = new Transaction({
      phone: referrer.phone,
      type: 'Referral Bonus',
      amount: rewardAmount,
      status: 'Success',
      description: `Level ${level} referral bonus (${percent*100}%) from wallet recharge of ₹${amount} by user ${user.username}`,
    });
    await transaction.save();
    await referrer.save();

    // Notify the referrer about the bonus if using Socket.IO
    const io = getIO(req);
    if (io) {
      io.emit(`user:${referrer._id}:notification`, {
        type: 'referralBonus',
        message: `You earned ₹${rewardAmount.toFixed(2)} (${percent*100}%) from ${user.username}'s wallet recharge of ₹${amount}!`,
      });
    }
  }

  await processReward(1, level1InviteCode, REFERRAL_REWARD_PERCENT.level1);
  await processReward(2, level2InviteCode, REFERRAL_REWARD_PERCENT.level2);
  await processReward(3, level3InviteCode, REFERRAL_REWARD_PERCENT.level3);
}

// --- Wallet recharge callback route (with referral rewards) ---
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
    await distributeReferralRewards({ user, amount, req });

    // Create transaction record for the recharge
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
    if (io) {
      io.emit('paymentComplete', {
        phone: user.phone,
        wallet: user.wallet,
        amount: amount
      });
    }

    res.status(200).json({ msg: "Recharge successful", wallet: user.wallet });
  } catch (err) {
    console.error('Error in payment verification:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// --- Manual wallet recharge route (with referral rewards) ---
router.post('/transaction/recharge', async (req, res) => {
  const { phone, amount, transactionPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    const rechargeAmount = parseFloat(amount);
    user.wallet += rechargeAmount;
    await user.save();

    // Distribute invite rewards based on recharge amount
    await distributeReferralRewards({ user, amount: rechargeAmount, req });

    // Create transaction record for the recharge
    const transaction = new Transaction({
      phone,
      type: 'Recharge',
      amount: rechargeAmount,
      status: 'Success',
      description: `Wallet recharged with ₹${rechargeAmount}. Thank you for using our service!`,
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
        bankInfo: user.bankInfo ? {
          accountNumber: user.bankInfo.accountNumber || '',
          ifscCode: user.bankInfo.ifscCode || '',
          realName: user.bankInfo.realName || ''
        } : null
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
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

// Update the route to get referrals by user ID instead of invite code
router.get('/profile/team/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    // Find the user by ID
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Check if the user has a team
    if (!user.team || user.team.length === 0) {
      return res.json({ 
        team: [],
        stats: {
          totalTeamMembers: 0,
          level1Count: 0,
          level2Count: 0,
          level3Count: 0
        }
      });
    }

    // Get detailed information about each team member
    const teamWithDetails = await Promise.all(
      user.team.map(async (member) => {
        try {
          const memberDetails = await User.findById(member._id);
          if (!memberDetails) {
            return {
              _id: member._id,
              phone: member.phone,
              username: member.username || 'Unknown',
              level: member.level,
              joinedAt: member.joinedAt
            };
          }
          
          return {
            _id: memberDetails._id,
            phone: memberDetails.phone,
            username: memberDetails.username,
            level: member.level,
            joinedAt: member.joinedAt || memberDetails.createdAt
          };
        } catch (err) {
          console.error(`Error fetching team member details: ${err.message}`);
          return {
            _id: member._id,
            phone: member.phone,
            username: member.username || 'Unknown',
            level: member.level,
            joinedAt: member.joinedAt
          };
        }
      })
    );

    // Calculate team statistics
    const level1Members = teamWithDetails.filter(m => m.level === 1);
    const level2Members = teamWithDetails.filter(m => m.level === 2);
    const level3Members = teamWithDetails.filter(m => m.level === 3);

    res.json({
      team: teamWithDetails,
      stats: {
        totalTeamMembers: teamWithDetails.length,
        level1Count: level1Members.length,
        level2Count: level2Members.length,
        level3Count: level3Members.length
      }
    });
  } catch (err) {
    console.error('Error fetching team data:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Keep the existing route for backward compatibility
router.get('/profile/referrals/:inviteCode', async (req, res) => {
  const { inviteCode } = req.params;

  try {
    // Find the referrer user by inviteCode
    const referrer = await User.findOne({ inviteCode });
    if (!referrer) return res.status(404).json({ msg: 'Referrer not found' });

    // Check if the user has a team
    if (!referrer.team || referrer.team.length === 0) {
      return res.json({ 
        referrals: [],
        stats: {
          totalReferrals: 0,
          referralEarnings: referrer.referralEarnings || 0
        }
      });
    }

    // Manually populate team members with more details
    const populatedTeam = await Promise.all(
      referrer.team.map(async (member) => {
        try {
          const userDetails = await User.findById(member._id);
          if (!userDetails) {
            return {
              _id: member._id,
              phone: member.phone,
              username: member.username || 'Unknown',
              level: member.level,
              joinedAt: member.joinedAt
            };
          }
          
          return {
            _id: userDetails._id,
            phone: userDetails.phone,
            username: userDetails.username,
            level: member.level,
            joinedAt: member.joinedAt || userDetails.createdAt
          };
        } catch (err) {
          console.error(`Error fetching team member details: ${err.message}`);
          return {
            _id: member._id,
            phone: member.phone,
            username: member.username || 'Unknown',
            level: member.level,
            joinedAt: member.joinedAt
          };
        }
      })
    );

    // Calculate referral statistics
    const totalReferrals = populatedTeam.length;
    const totalEarnings = 
      (referrer.referralEarnings?.level1 || 0) + 
      (referrer.referralEarnings?.level2 || 0) + 
      (referrer.referralEarnings?.level3 || 0);

    // Return populated team with stats
    res.status(200).json({ 
      referrals: populatedTeam,
      stats: {
        totalReferrals,
        referralEarnings: totalEarnings
      }
    });
  } catch (err) {
    console.error('Error fetching referrals:', err.message);
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

// Get total referral earnings for a user
router.get('/referral-earnings/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Get total earnings from referral transactions
    const totalEarnings = await Transaction.aggregate([
      {
        $match: {
          phone: user.phone,
          type: 'Referral Bonus',
          status: 'Success'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    res.status(200).json({
      totalEarnings: totalEarnings[0]?.total || 0
    });
  } catch (err) {
    console.error('Error fetching referral earnings:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Get referral transactions between referrer and referred user
router.get('/referral-transactions/:referrerPhone/:referredPhone', async (req, res) => {
  const { referrerPhone, referredPhone } = req.params;
  try {
    const transactions = await Transaction.find({
      phone: referrerPhone,
      type: 'Referral Bonus',
      status: 'Success',
      description: { $regex: new RegExp(referredPhone, 'i') }
    });

    const totalEarnings = transactions.reduce((sum, tx) => sum + tx.amount, 0);

    res.status(200).json({
      transactions,
      totalEarnings
    });
  } catch (err) {
    console.error('Error fetching referral transactions:', err.message);
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

// GET /api/auth/team-members/:userId
router.get('/team-members/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    console.log(`Fetching team members for user ID: ${userId}`);
    
    const user = await User.findById(userId);
    if (!user) {
      console.log('User not found');
      return res.status(404).json({ msg: 'User not found' });
    }
    
    console.log(`User found: ${user.username}, Team size: ${user.team ? user.team.length : 0}`);
    
    // If user has no team or empty team array
    if (!user.team || user.team.length === 0) {
      console.log('User has no team members');
      return res.json({ 
        teamMembers: [],
        stats: {
          totalMembers: 0,
          level1: 0,
          level2: 0,
          level3: 0
        }
      });
    }
    
    // Log team data for debugging
    console.log('Raw team data:', JSON.stringify(user.team));
    
    // Get detailed information for each team member
    const teamMembers = await Promise.all(
      user.team.map(async (member) => {
        try {
          const memberDetails = await User.findById(member._id);
          if (!memberDetails) {
            console.log(`Team member not found: ${member._id}`);
            return {
              _id: member._id,
              phone: member.phone,
              username: member.username || 'Unknown',
              level: member.level,
              joinedAt: member.joinedAt
            };
          }
          
          return {
            _id: memberDetails._id,
            phone: memberDetails.phone,
            username: memberDetails.username,
            level: member.level,
            joinedAt: member.joinedAt || memberDetails.createdAt
          };
        } catch (err) {
          console.error(`Error fetching team member details: ${err.message}`);
          return {
            _id: member._id,
            phone: member.phone,
            username: member.username || 'Unknown',
            level: member.level,
            joinedAt: member.joinedAt
          };
        }
      })
    );
    
    // Calculate statistics
    const level1 = teamMembers.filter(m => m.level === 1).length;
    const level2 = teamMembers.filter(m => m.level === 2).length;
    const level3 = teamMembers.filter(m => m.level === 3).length;
    
    console.log(`Returning ${teamMembers.length} team members`);
    
    res.json({
      teamMembers,
      stats: {
        totalMembers: teamMembers.length,
        level1,
        level2,
        level3
      }
    });
  } catch (err) {
    console.error('Error fetching team members:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

module.exports = router;