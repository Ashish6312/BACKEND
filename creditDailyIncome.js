const Purchase = require('./models/Purchase');
const User = require('./models/User');
const Transaction = require('./models/Transaction'); // Import Transaction model

const creditDailyIncome = async (io) => {
  try {
    console.log('Starting daily income crediting...');

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight

    // 1. Find all active purchases
    const activePurchases = await Purchase.find({ status: 'active' });

    for (const purchase of activePurchases) {
      // Optional: Check if already credited today
      if (purchase.lastIncomeDate) {
        const lastIncomeDate = new Date(purchase.lastIncomeDate);
        lastIncomeDate.setHours(0, 0, 0, 0);
        if (lastIncomeDate.getTime() === today.getTime()) {
          console.log(`Already credited today for purchase ${purchase._id}`);
          continue; // Skip if already credited today
        }
      }

      // 2. Find the user associated with the purchase
      const user = await User.findById(purchase.userId);

      if (user) {
        console.log(`Crediting ${purchase.dailyIncome} to user ${user.phone} for purchase ${purchase._id}`);

        // Immediately credit to wallet
        user.wallet += purchase.dailyIncome;
        await user.save();

        // Update purchase records
        purchase.totalEarned += purchase.dailyIncome;
        purchase.lastIncomeDate = today;
        await purchase.save();

        // Create a transaction record
        const newTransaction = new Transaction({
          phone: user.phone,
          type: 'Earning',
          amount: purchase.dailyIncome,
          status: 'Success',
          date: new Date(),
          // Optional: you can add more details if you want
          description: `Daily income from ${purchase.planName}`,
          planId: purchase.planId,
          purchaseId: purchase._id
        });
        
        await newTransaction.save();
        console.log(`Transaction record created for user ${user.phone}`);

        console.log(`Successfully credited ${purchase.dailyIncome} to user ${user.phone}. Wallet balance: ${user.wallet}`);
        
        // Emit socket event to update client wallet in real-time
        if (io) {
          io.emit('walletUpdated', {
            userId: user._id.toString(),
            newWallet: user.wallet,
            amount: purchase.dailyIncome,
            transactionType: 'Earning',
            planName: purchase.planName
          });
          console.log(`Socket event emitted for user ${user._id}`);
        }
      } else {
        console.log(`User not found for purchase ${purchase._id}`);
      }
    }

    console.log('Daily income crediting completed.');
  } catch (error) {
    console.error('Error in creditDailyIncome:', error);
  }
};

module.exports = creditDailyIncome;