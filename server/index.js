require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const roomsRouter = require('./routes/rooms');
const { registerRoomHandlers } = require('./socket/roomHandlers');

const app = express();
app.use(express.json());

app.use(cors({ origin: process.env.FRONTEND_URL }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL }
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/rooms', roomsRouter);

io.on('connection', socket => registerRoomHandlers(io, socket));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
