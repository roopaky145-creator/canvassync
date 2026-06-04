require('dotenv').config();
require('./models/Room');
require('./models/Board');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const roomsRouter = require('./routes/rooms');
const aiRoutes = require('./routes/ai');
const boardRoutes = require('./routes/boardRoutes');
const { registerRoomHandlers } = require('./socket/roomHandlers');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use(cors({ 
  origin: process.env.FRONTEND_URL,
  methods: ["GET", "POST"]
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.warn('MongoDB unavailable — real-time features still work. Reason:', err.message));

app.use('/api/rooms', roomsRouter);
app.use('/api/ai', aiRoutes(io));
app.use('/api/board', boardRoutes);

io.on('connection', socket => registerRoomHandlers(io, socket));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
