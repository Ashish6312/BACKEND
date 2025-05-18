const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyAdmin } = require('../middleware/authMiddleware');
const Plan = require('../models/Plan');

// Ensure the upload folder exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'plans');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Folder already created above
  },
  filename: function (req, file, cb) {
    const uniqueName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// GET all plans
router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find();
    res.json(plans);
  } catch (err) {
    console.error("Error fetching plans:", err);
    res.status(500).json({ msg: 'Failed to fetch plans' });
  }
});

// POST new plan (Admin only)
router.post('/', verifyAdmin, upload.single('image'), async (req, res) => {
  try {
    const { name, price, dailyIncome, planType, duration } = req.body;
    const image = req.file ? `/uploads/plans/${req.file.filename}` : null;

    if (!name || !price || !dailyIncome || !planType) {
      return res.status(400).json({ msg: 'All fields are required' });
    }

    const newPlan = new Plan({ 
      name, 
      price: parseFloat(price), 
      dailyIncome: parseFloat(dailyIncome), 
      planType, 
      image,
      duration: duration ? parseInt(duration) : 365 // Parse duration from request
    });

    await newPlan.save();
    console.log('Plan created successfully:', newPlan);
    res.status(201).json(newPlan);
  } catch (err) {
    console.error("Error creating plan:", err);
    res.status(500).json({ msg: 'Failed to create plan', error: err.message });
  }
});

// PUT update plan (Admin only)
router.put('/:id', verifyAdmin, upload.single('image'), async (req, res) => {
  const { name, price, dailyIncome, planType, duration } = req.body;
  const updateFields = { 
    name, 
    price: parseFloat(price), 
    dailyIncome: parseFloat(dailyIncome), 
    planType,
    duration: duration ? parseInt(duration) : 365 // Parse duration from request
  };

  if (req.file) {
    updateFields.image = `/uploads/plans/${req.file.filename}`;
  }

  try {
    const updatedPlan = await Plan.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true }
    );

    if (!updatedPlan) {
      return res.status(404).json({ msg: 'Plan not found' });
    }

    res.json(updatedPlan);
  } catch (err) {
    console.error("Error updating plan:", err);
    res.status(500).json({ msg: 'Failed to update plan', error: err.message });
  }
});

// DELETE a plan (Admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const deletedPlan = await Plan.findByIdAndDelete(req.params.id);

    if (!deletedPlan) {
      return res.status(404).json({ msg: 'Plan not found' });
    }

    res.json({ msg: 'Plan deleted successfully' });
  } catch (err) {
    console.error("Error deleting plan:", err);
    res.status(500).json({ msg: 'Failed to delete plan', error: err.message });
  }
});

module.exports = router;
