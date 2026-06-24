const activeLocks = new Map(); // module scope — ONE instance for the entire process

function registerRoomHandlers(io, socket) {
  socket.on('join_room', (roomCode) => {
    if (socket.roomCode) socket.leave(socket.roomCode);
    socket.roomCode = roomCode;
    socket.join(roomCode);
  });

  socket.on('canvas_update', (data) => {
    if (!data?.roomCode || !socket.rooms.has(data.roomCode)) return;
    socket.to(data.roomCode).emit('canvas_update', data);
  });

  socket.on('canvas_delete', (data) => {
    if (!data?.roomCode || !data?.objectId || !socket.rooms.has(data.roomCode)) return;
    activeLocks.delete(data.objectId);
    socket.to(data.roomCode).emit('canvas_delete', { objectId: data.objectId });
  });
}

module.exports = { registerRoomHandlers, activeLocks };
