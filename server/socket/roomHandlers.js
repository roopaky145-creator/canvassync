const activeLocks = new Map(); // module scope — ONE instance for the entire process

// activeRoomLocks[roomCode] = { objectId: socketId, ... }
const activeRoomLocks = {};

const roomTransientLedger = {};
const roomEventCounters = {};
function registerRoomHandlers(io, socket) {
  socket.on('join_room', (roomCode) => {
    if (socket.roomCode) socket.leave(socket.roomCode);
    socket.roomCode = roomCode;
    socket.join(roomCode);
    if (activeRoomLocks[roomCode]) {
      socket.emit('sync_active_locks_on_join', activeRoomLocks[roomCode]);
    }
  });

  socket.on('request_transient_ledger', (roomCode) => {
    socket.emit('sync_transient_ledger', roomTransientLedger[roomCode] || []);
  });

  socket.on('request_lock_sync', (roomCode) => {
    if (activeRoomLocks[roomCode]) {
      socket.emit('sync_active_locks_on_join', activeRoomLocks[roomCode]);
    }
  });

  socket.on('canvas_update', (data) => {
    if (!data?.roomCode || !socket.rooms.has(data.roomCode) || !data?.objectData?.id) return;
    
    // Server Trust: Reject update if locked by another user
    const lockKey = `${data.roomCode}::${data.objectData.id}`;
    if (activeLocks.has(lockKey) && activeLocks.get(lockKey) !== socket.id) {
      return;
    }
    
    if (!roomEventCounters[data.roomCode]) roomEventCounters[data.roomCode] = 0;
    const eventId = ++roomEventCounters[data.roomCode];
    data.eventId = eventId; // Embed directly in the payload

    if (!roomTransientLedger[data.roomCode]) roomTransientLedger[data.roomCode] = [];
    roomTransientLedger[data.roomCode].push({ event: 'canvas_update', data, timestamp: Date.now(), eventId });

    socket.to(data.roomCode).emit('canvas_update', data);
  });

  socket.on('canvas_delete', (data) => {
    if (!data?.roomCode || !data?.objectId || !socket.rooms.has(data.roomCode)) return;
    
    // Server Trust: Reject delete if locked by another user
    const lockKey = `${data.roomCode}::${data.objectId}`;
    if (activeLocks.has(lockKey) && activeLocks.get(lockKey) !== socket.id) {
      return;
    }

    activeLocks.delete(lockKey);

    if (!roomEventCounters[data.roomCode]) roomEventCounters[data.roomCode] = 0;
    const eventId = ++roomEventCounters[data.roomCode];
    data.eventId = eventId; // Embed directly in the payload

    if (!roomTransientLedger[data.roomCode]) roomTransientLedger[data.roomCode] = [];
    roomTransientLedger[data.roomCode].push({ event: 'canvas_delete', data, timestamp: Date.now(), eventId });

    socket.to(data.roomCode).emit('canvas_delete', data);
  });

  // Acquire a lock — first come, first served (room-scoped)
  socket.on('acquire_lock', (data) => {
    if (!data?.object_id || !data?.roomCode || !socket.rooms.has(data.roomCode)) return;
    const lockKey = `${data.roomCode}::${data.object_id}`;
    if (!activeLocks.has(lockKey)) {
      activeLocks.set(lockKey, socket.id);
      if (!activeRoomLocks[data.roomCode]) activeRoomLocks[data.roomCode] = {};
      activeRoomLocks[data.roomCode][data.object_id] = socket.id;
      io.to(data.roomCode).emit('lock_acquired', {
        object_id: data.object_id,
        lockedBy: socket.id
      });
    }
  });

  // Release a lock — only the owner can release
  socket.on('release_lock', (data) => {
    if (!data?.object_id || !data?.roomCode || !socket.rooms.has(data.roomCode)) return;
    const lockKey = `${data.roomCode}::${data.object_id}`;
    if (activeLocks.get(lockKey) === socket.id) {
      activeLocks.delete(lockKey);
      if (activeRoomLocks[data.roomCode] && activeRoomLocks[data.roomCode][data.object_id]) {
        delete activeRoomLocks[data.roomCode][data.object_id];
      }
      io.to(data.roomCode).emit('lock_released', { object_id: data.object_id });
    }
  });

  // On disconnect — release all locks held by this socket
  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    activeLocks.forEach((ownerId, lockKey) => {
      if (ownerId === socket.id) {
        activeLocks.delete(lockKey);
      }
    });
    if (activeRoomLocks[roomCode]) {
      for (const objectId in activeRoomLocks[roomCode]) {
        if (activeRoomLocks[roomCode][objectId] === socket.id) {
          delete activeRoomLocks[roomCode][objectId];
        }
      }
    }
    io.to(roomCode).emit('user_disconnected_locks_cleared', socket.id);
  });
}

module.exports = { registerRoomHandlers, activeLocks, roomTransientLedger, roomEventCounters };
