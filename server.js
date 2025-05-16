const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const planRoutes = require('./routes/plan');
const purchaseRoutes = require('./routes/purchase');
const creditDailyIncome = require('./creditDailyIncome');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins (you can restrict to your frontend URL)
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use(cors());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Make io available to the routes
app.set('io', io);

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/uploads', express.static('uploads'));


// Set up cron job if needed
const cron = require('node-cron');

cron.schedule('0 0 * * *', () => { // Every minute for testing
  console.log('Running daily income crediting...');
  creditDailyIncome(io); // pass io to creditDailyIncome
}, {
  scheduled: true,
  timezone: 'Asia/Kolkata'
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));