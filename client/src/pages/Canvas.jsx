import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { throttle } from 'lodash';
import { fabric } from 'fabric';

import Toolbar from '../components/Toolbar';
import AIPromptPanel from '../components/AIPromptPanel';

fabric.Image.prototype.crossOrigin = 'anonymous';

const AI_IMAGE_SIZE_LIMIT_BYTES = 200 * 1024;

const getBase64ByteSize = (base64) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

// Strip heavy base64 src from image objects before sending over socket.
// AI images are already loaded on all clients via ai_image_generated broadcast,
// so we only need to sync position/scale/rotation — not the multi-MB src payload.
const getCompactObjectData = (obj) => {
  const data = obj.toJSON(['id']);
  if (data.type === 'image' && data.src && data.src.length > 1000) {
    delete data.src;
  }
  return data;
};

const Canvas = () => {
  const { code: roomCode } = useParams();
  const [activeTool, setActiveTool] = useState('select');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushWidth, setBrushWidth] = useState(2);
  const [isSaving, setIsSaving] = useState(false);
  const [isBoardLoading, setIsBoardLoading] = useState(true);
  const isBoardLoadingRef = useRef(true);
  const serverWatermarkRef = useRef(0);
  const completedEventIdsRef = useRef(new Set());
  const pendingUpdatesRef = useRef([]); // The Event Buffer
  const pendingImagePositionsRef = useRef({}); // Buffered positions for AI images from generating client
  const pendingLocksRef = useRef(null);
  const canvasRef = useRef(null);        // Needed by handleSave in Phase 5
  const currentColorRef = useRef(brushColor);
  const currentWidthRef = useRef(brushWidth);

  useEffect(() => {
    currentColorRef.current = brushColor;
    currentWidthRef.current = brushWidth;
  }, [brushColor, brushWidth]);

  const isReceivingUpdate = useRef(false); // Prevents infinite broadcast loops
  const socketRef = useRef(null);         // Exposed for Phase 4 AI panel
  const lastAddedObjectRef = useRef(null);
  const redoObjectRef = useRef(null);

  // Reset tool state when switching rooms without unmount
  useEffect(() => {
    setActiveTool('select');
  }, [roomCode]);

  const handleUndo = () => {
    if (lastAddedObjectRef.current) {
      const obj = lastAddedObjectRef.current;
      if (canvasRef.current && canvasRef.current.getObjects().includes(obj)) {
        // Let object:removed handle the socket emit — just guard against double-emit
        canvasRef.current.remove(obj);
        redoObjectRef.current = obj;
        lastAddedObjectRef.current = null;
      }
    }
  };

  const handleRedo = () => {
    if (redoObjectRef.current) {
      const obj = redoObjectRef.current;
      if (canvasRef.current) {
        canvasRef.current.add(obj);
        lastAddedObjectRef.current = obj;
        redoObjectRef.current = null;
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Reset hydration and undo/redo state when switching rooms without unmounting
    isBoardLoadingRef.current = true;
    if (serverWatermarkRef) serverWatermarkRef.current = 0;
    if (completedEventIdsRef) completedEventIdsRef.current.clear();
    pendingUpdatesRef.current = [];
    pendingImagePositionsRef.current = {};
    pendingLocksRef.current = null;
    if (lastAddedObjectRef) lastAddedObjectRef.current = null;
    if (redoObjectRef) redoObjectRef.current = null;
    setIsBoardLoading(true);

    const socket = io(process.env.REACT_APP_BACKEND_URL);
    socketRef.current = socket;
    const canvas = new fabric.Canvas('canvas-el');
    canvasRef.current = canvas;

    // Helper function to apply locks safely at any point in the lifecycle
    const applyActiveLocks = (locksMap) => {
      if (!locksMap || !canvasRef.current) return;
      let requiresRender = false;
      Object.keys(locksMap).forEach(objectId => {
        const lockedBySocketId = locksMap[objectId];
        if (lockedBySocketId === socket.id) return; 

        const obj = canvasRef.current.getObjects().find(o => o.id === objectId);
        if (obj && obj.selectable !== false) {
          obj.set({
            _originalOpacity: obj.opacity || 1,
            _originalStroke: obj.stroke,
            _originalStrokeWidth: obj.strokeWidth || 0,
            selectable: false,
            evented: false,
            opacity: 0.5,
            _lockedBy: lockedBySocketId
          });
          requiresRender = true;
        }
      });
      if (requiresRender) canvasRef.current.renderAll();
    };

    // 1. Register listener FIRST
    socket.on('sync_active_locks_on_join', (locksMap) => {
      if (isBoardLoadingRef.current) {
        pendingLocksRef.current = locksMap;
      } else {
        applyActiveLocks(locksMap);
      }
    });

    // 2. Emit join SECOND
    socket.emit('join_room', roomCode);

    // ── EMIT SIDE ────────────────────────────────────────────────
    canvas.on('object:added', (e) => {
      if (isBoardLoadingRef && isBoardLoadingRef.current) return;
      if (!e.target.id) e.target.set('id', uuidv4());
      if (!isReceivingUpdate.current && !isDrawingShape) {
        socket.emit('canvas_update', { roomCode, objectData: getCompactObjectData(e.target) });
      }
    });

    const throttledMove = throttle((e) => {
      if (isBoardLoadingRef && isBoardLoadingRef.current) return;
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_update', { roomCode, objectData: getCompactObjectData(e.target) });
    }, 50);

    canvas.on('object:moving', throttledMove);

    canvas.on('object:modified', (e) => {
      if (isBoardLoadingRef && isBoardLoadingRef.current) return;
      throttledMove.flush();
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_update', { roomCode, objectData: getCompactObjectData(e.target) });
    });

    canvas.on('object:removed', (e) => {
      if (isBoardLoadingRef && isBoardLoadingRef.current) return;
      if (!e.target.id) return; // guard: never emit delete for objects without an ID
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_delete', { roomCode, objectId: e.target.id });
    });

    canvas.on('path:created', (e) => {
      if (!e.path.id) e.path.set('id', uuidv4());
      lastAddedObjectRef.current = e.path;
      redoObjectRef.current = null;
    });

    canvas.on('mouse:down', (opt) => {
      const tool = window.CANVAS_ACTIVE_TOOL || 'select';
      if (tool === 'eraser' && opt.target) {
        canvas.remove(opt.target);
        // The object:removed listener will handle the socket broadcast
        return;
      }
    });

    // ── ROOPAK'S SHAPE DRAWING LOGIC ─────────────────────────────
    const supportedDrawingTools = new Set(['rect', 'circle', 'line', 'text']);
    let isDrawingShape = false;
    let drawingTool = null;
    let origX = 0;
    let origY = 0;
    let tempShape = null;

    canvas.on('mouse:down', (o) => {
      const tool = window.CANVAS_ACTIVE_TOOL || 'select';
      if (!supportedDrawingTools.has(tool)) return;

      const pointer = canvas.getPointer(o.e);

      if (tool === 'text') {
        const textObj = new fabric.IText('', {
          left: pointer.x,
          top: pointer.y,
          fill: currentColorRef.current,
          fontSize: Math.max(16, currentWidthRef.current * 5),
          id: uuidv4(),
          selectable: true
        });
        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        textObj.enterEditing();
        
        lastAddedObjectRef.current = textObj;
        redoObjectRef.current = null;
        
        // Removed setActiveTool('select') so the user stays in edit mode to type
        return;
      }

      // Discard any active selection so existing objects don't move with the mouse
      canvas.discardActiveObject();
      canvas.renderAll();

      isDrawingShape = true;
      drawingTool = tool;
      origX = pointer.x;
      origY = pointer.y;

      if (tool === 'rect') {
        tempShape = new fabric.Rect({
          left: origX, top: origY, originX: 'left', originY: 'top', width: 0, height: 0,
          fill: 'transparent', stroke: currentColorRef.current, strokeWidth: currentWidthRef.current, selectable: false, id: uuidv4()
        });
      } else if (tool === 'circle') {
        tempShape = new fabric.Circle({
          left: origX, top: origY, originX: 'center', originY: 'center', radius: 0,
          fill: 'transparent', stroke: currentColorRef.current, strokeWidth: currentWidthRef.current, selectable: false, id: uuidv4()
        });
      } else if (tool === 'line') {
        tempShape = new fabric.Line([origX, origY, origX, origY], {
          stroke: currentColorRef.current, strokeWidth: currentWidthRef.current, selectable: false, id: uuidv4()
        });
      }

      canvas.add(tempShape);
    });

    canvas.on('mouse:move', (o) => {
      if (!isDrawingShape || !tempShape) return;

      const pointer = canvas.getPointer(o.e);
      const dx = pointer.x - origX;
      const dy = pointer.y - origY;

      if (drawingTool === 'rect') {
        tempShape.set({
          left: Math.min(origX, pointer.x),
          top: Math.min(origY, pointer.y),
          width: Math.abs(dx),
          height: Math.abs(dy)
        });
      } else if (drawingTool === 'circle') {
        tempShape.set({
          left: origX + dx / 2,
          top: origY + dy / 2,
          radius: Math.max(Math.abs(dx), Math.abs(dy)) / 2
        });
      } else if (drawingTool === 'line') {
        tempShape.set({ x2: pointer.x, y2: pointer.y });
      }

      tempShape.set({ stroke: currentColorRef.current, strokeWidth: currentWidthRef.current });
      tempShape.setCoords();
      canvasRef.current.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (!isDrawingShape || !tempShape) return;

      isDrawingShape = false;

      const isZeroSize =
        (tempShape.type === 'rect' && (tempShape.width < 2 || tempShape.height < 2)) ||
        (tempShape.type === 'circle' && tempShape.radius < 2);

      if (isZeroSize) {
        isReceivingUpdate.current = true;
        canvas.remove(tempShape);
        isReceivingUpdate.current = false;
      } else {
        tempShape.setCoords();
        tempShape.set({ selectable: true });
        
        lastAddedObjectRef.current = tempShape;
        redoObjectRef.current = null;

        if (!isReceivingUpdate.current) {
          socketRef.current.emit('canvas_update', { roomCode, objectData: tempShape.toJSON(['id']) });
        }
      }

      tempShape = null;
      drawingTool = null;
      // window.CANVAS_ACTIVE_TOOL = 'select';
      // setActiveTool('select');
    });

    canvas.on('selection:created', (e) => {
      const obj = e.selected[0];
      if (obj && obj.id) {
        socket.emit('acquire_lock', { roomCode, object_id: obj.id });
      }
    });

    canvas.on('selection:updated', (e) => {
      if (e.deselected && e.deselected[0] && e.deselected[0].id) {
        socket.emit('release_lock', { roomCode, object_id: e.deselected[0].id });
      }
      const obj = e.selected[0];
      if (obj && obj.id) {
        socket.emit('acquire_lock', { roomCode, object_id: obj.id });
      }
    });

    canvas.on('selection:cleared', (e) => {
      if (e.deselected && e.deselected[0] && e.deselected[0].id) {
        socket.emit('release_lock', { roomCode, object_id: e.deselected[0].id });
      }
    });

    // ── ROOPAK'S DELETE HANDLER ──────────────────────────────────
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
          e.preventDefault();
          canvas.discardActiveObject();
          activeObjects.forEach(obj => canvas.remove(obj));
          canvas.renderAll();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // ── RECEIVE SIDE ─────────────────────────────────────────────
    const handleCanvasUpdate = (data, canvasInstance = canvas) => {
      const activeObj = canvasInstance.getActiveObject();
      if (activeObj?.id === data.objectData.id && !activeObj._lockedBy) return;
      isReceivingUpdate.current = true;
      const existing = canvasInstance.getObjects().find(o => o.id === data.objectData.id);
      if (existing) {
        try {
          if (data.objectData.type === 'line') {
            const { x1, y1, x2, y2, left, top, ...rest } = data.objectData;
            existing.set(rest);
            existing.set({ x1, y1, x2, y2 });
            existing.set({ left, top });
          } else if (existing.type === 'image' || data.objectData.type === 'image') {
            // For images, update coordinates/scaling but NEVER blindly overwrite the src via .set()
            const safeData = { ...data.objectData };
            delete safeData.src; 
            existing.set(safeData);
          } else {
            existing.set(data.objectData);
          }
          if (existing._lockedBy && existing._lockedBy !== socket.id) {
            existing.set({
              selectable: false,
              evented: false,
              opacity: 0.5,
              strokeWidth: existing._originalStrokeWidth || existing.strokeWidth || 0
            });
          }
          existing.setCoords();
          canvasInstance.renderAll();
          advanceWatermarkContiguously(data?.eventId);
        } finally {
          isReceivingUpdate.current = false;
        }
      } else {
        // If this is an image with no src, it would create a ghost bounding box.
        // Buffer the position data so the ai_image_generated handler can use it.
        if (data.objectData && data.objectData.type === 'image' && !data.objectData.src) {
          pendingImagePositionsRef.current[data.objectData.id] = data.objectData;
          advanceWatermarkContiguously(data?.eventId);
          isReceivingUpdate.current = false;
          return;
        }
        if (data.objectData && data.objectData.type === 'image') {
          data.objectData.crossOrigin = 'anonymous';
        }
        // When an object from the socket is NOT found on the local canvas:
        fabric.util.enlivenObjects([data.objectData], (enlivenedObjects) => {
          try {
            if (enlivenedObjects && enlivenedObjects[0]) {
              const newObj = enlivenedObjects[0];
              canvasInstance.add(newObj);
              canvasInstance.renderAll();
            }
            advanceWatermarkContiguously(data?.eventId);
          } finally {
            isReceivingUpdate.current = false;
          }
        });
      }
    };

    socket.on('canvas_update', (data) => {
      if (isBoardLoadingRef.current) {
        pendingUpdatesRef.current.push({ event: 'canvas_update', data });
        return;
      }
      handleCanvasUpdate(data);
    });

    const handleCanvasDelete = (data, canvasInstance = canvas) => {
      isReceivingUpdate.current = true;
      const obj = canvasInstance.getObjects().find(o => o.id === data.objectId);
      if (obj) { canvasInstance.remove(obj); canvasInstance.renderAll(); }
      advanceWatermarkContiguously(data?.eventId);
      isReceivingUpdate.current = false;
    };

    socket.on('canvas_delete', (data) => {
      if (isBoardLoadingRef.current) {
        pendingUpdatesRef.current.push({ event: 'canvas_delete', data });
        return;
      }
      handleCanvasDelete(data);
    });

    // ── PHASE 3: LOCKING LISTENERS ──────────────────────────────
    socket.on('lock_acquired', (data) => {
      if (data.lockedBy === socket.id) return;
      if (isBoardLoadingRef.current) {
        if (!pendingLocksRef.current) pendingLocksRef.current = {};
        pendingLocksRef.current[data.object_id] = data.lockedBy;
        return;
      }
      const obj = canvas.getObjects().find(o => o.id === data.object_id);
      if (!obj) {
        if (!pendingLocksRef.current) pendingLocksRef.current = {};
        pendingLocksRef.current[data.object_id] = data.lockedBy;
        return;
      }
      if (obj.selectable === false) return;
        // Save original appearance for restoration on unlock
        obj.set({
          _originalOpacity: obj.opacity || 1,
          _originalStroke: obj.stroke,
          _originalStrokeWidth: obj.strokeWidth || 0
        });
        // Checkpoint spec: red stroke + 0.5 opacity
        obj.set({
          selectable: false,
          evented: false,
          opacity: 0.5,
          _lockedBy: data.lockedBy
        });
        canvas.renderAll();
    });

    socket.on('lock_released', (data) => {
      if (isBoardLoadingRef.current) {
        if (pendingLocksRef.current) {
          delete pendingLocksRef.current[data.object_id];
        }
        return;
      }
      const obj = canvas.getObjects().find(o => o.id === data.object_id);
      if (!obj) {
        if (pendingLocksRef.current) delete pendingLocksRef.current[data.object_id];
        return;
      }

      // Only restore visual properties if this object was actually locked
      // on THIS client. If we were the locker, _lockedBy was never set
      // (lock_acquired skips our own socket), so _originalStroke etc.
      // were never saved — restoring them would set stroke to undefined
      // and make the object invisible.
      if (obj._lockedBy) {
        obj.set({
          selectable: true,
          evented: true,
          opacity: obj._originalOpacity || 1,
          stroke: obj._originalStroke,
          strokeWidth: obj._originalStrokeWidth || obj.strokeWidth || 0,
          _lockedBy: null
        });
        canvas.renderAll();
      } else {
        // We were the locker — just clear internal state, no visual change needed
        obj._lockedBy = null;
      }
    });

    socket.on('user_disconnected_locks_cleared', (disconnectedSocketId) => {
      let requiresRender = false;
      canvas.getObjects().forEach((obj) => {
        if (obj._lockedBy === disconnectedSocketId) {
          obj.set({ 
            selectable: true, 
            evented: true, 
            opacity: obj._originalOpacity || 1, 
            stroke: obj._originalStroke,
            strokeWidth: obj._originalStrokeWidth || obj.strokeWidth || 0,
            _lockedBy: null 
          });
          requiresRender = true;
        }
      });
      if (requiresRender) canvas.renderAll();
    });

    // ── PHASE 4: AI IMAGE LISTENER ──────────────────────────────
    socket.on('ai_image_generated', (data) => {
      if (!data?.base64 || !data?.imageId) {
        console.warn('[CanvasSync] AI image payload missing base64 or imageId.');
        return;
      }

      // Guard: if this image was already added (e.g. duplicate event), skip
      // BUT if the existing object is a ghost (no rendered pixels), replace it
      const alreadyExists = canvas.getObjects().find(o => o.id === data.imageId);
      if (alreadyExists) {
        const isGhost = alreadyExists.type === 'image' && (!alreadyExists._element || !alreadyExists._element.naturalWidth);
        if (isGhost) {
          isReceivingUpdate.current = true;
          canvas.remove(alreadyExists);
          isReceivingUpdate.current = false;
        } else {
          return; // Real image exists, skip
        }
      }

      if (getBase64ByteSize(data.base64) > AI_IMAGE_SIZE_LIMIT_BYTES) {
        console.warn('[CanvasSync] AI image exceeds 200KB. It will not be persisted on save.');
      }

      fabric.Image.fromURL(`data:image/png;base64,${data.base64}`, (img, isError) => {
        if (isError || !img || !img.width || !img.height) {
          console.warn('[CanvasSync] Could not load generated AI image.');
          return;
        }

        // Guard again after async fromURL — another event could have added it
        const existingAfterLoad = canvas.getObjects().find(o => o.id === data.imageId);
        if (existingAfterLoad) {
          const isGhost = existingAfterLoad.type === 'image' && (!existingAfterLoad._element || !existingAfterLoad._element.naturalWidth);
          if (isGhost) {
            isReceivingUpdate.current = true;
            canvas.remove(existingAfterLoad);
            isReceivingUpdate.current = false;
          } else {
            return; // Real image exists, skip
          }
        }

        const maxImageSize = Math.min(320, canvas.getWidth() * 0.35, canvas.getHeight() * 0.35);
        const scale = Math.min(maxImageSize / img.width, maxImageSize / img.height, 1);

        // Place at fixed center of canvas so all clients see it in the same spot
        const centerLeft = Math.round((canvas.getWidth() / 2) - (img.width * scale / 2));
        const centerTop = Math.round((canvas.getHeight() / 2) - (img.height * scale / 2));

        img.set({
          left: centerLeft,
          top: centerTop,
          id: data.imageId,   // Use the server-provided ID so all clients share the same ID
          scaleX: scale,
          scaleY: scale
        });

        // Apply buffered position from the generating client if available
        const bufferedPos = pendingImagePositionsRef.current[data.imageId];
        if (bufferedPos) {
          const safePos = { ...bufferedPos };
          delete safePos.src;
          delete safePos.type;
          img.set(safePos);
          delete pendingImagePositionsRef.current[data.imageId];
        }

        try {
          isReceivingUpdate.current = true;
          canvas.add(img);

          const pendingLockSocketId = pendingLocksRef.current?.[data.imageId];
          if (pendingLockSocketId && pendingLockSocketId !== socket.id) {
            img.set({
              _originalOpacity: img.opacity || 1,
              _originalStroke: img.stroke,
              _originalStrokeWidth: img.strokeWidth || 0,
              selectable: false,
              evented: false,
              opacity: 0.5,
              _lockedBy: pendingLockSocketId
            });
            delete pendingLocksRef.current[data.imageId];
          }

          canvas.renderAll();
          advanceWatermarkContiguously(data?.eventId);
        } finally {
          isReceivingUpdate.current = false;
        }
        // Broadcast final position so the server ledger records it for late joiners
        socket.emit('canvas_update', { roomCode, objectData: getCompactObjectData(img) });
      }, { crossOrigin: 'anonymous' });
    });

    const advanceWatermarkContiguously = (completedId) => {
      if (!completedId) return;

      // Add the finished event to the waiting room
      completedEventIdsRef.current.add(completedId);

      // Only advance the watermark if the NEXT expected sequence ID is in the waiting room
      let nextExpected = serverWatermarkRef.current + 1;
      while (completedEventIdsRef.current.has(nextExpected)) {
        completedEventIdsRef.current.delete(nextExpected); // Clean up memory
        serverWatermarkRef.current = nextExpected;
        nextExpected++;
      }
    };

    // ── PHASE 5: HIMANSHU ADDS loadBoard() CALL HERE ─────────────
    const flushEventBuffer = (canvasInstance) => {
      pendingUpdatesRef.current.forEach(({ event, data }) => {
        if (event === 'canvas_update') {
          handleCanvasUpdate(data, canvasInstance);
        } else if (event === 'canvas_delete') {
          handleCanvasDelete(data, canvasInstance);
        } else if (event === 'ai_image_generated') {
          if (!data?.base64 || !data?.imageId) return;
          const alreadyExists = canvasInstance.getObjects().find(o => o.id === data.imageId);
          if (alreadyExists) {
            const isGhost = alreadyExists.type === 'image' && (!alreadyExists._element || !alreadyExists._element.naturalWidth);
            if (isGhost) {
              isReceivingUpdate.current = true;
              canvasInstance.remove(alreadyExists);
              isReceivingUpdate.current = false;
            } else {
              return;
            }
          }

          fabric.Image.fromURL(`data:image/png;base64,${data.base64}`, (img, isError) => {
            if (isError || !img || !img.width || !img.height) return;
            const existingInFlush = canvasInstance.getObjects().find(o => o.id === data.imageId);
            if (existingInFlush) {
              const isGhost = existingInFlush.type === 'image' && (!existingInFlush._element || !existingInFlush._element.naturalWidth);
              if (isGhost) {
                isReceivingUpdate.current = true;
                canvasInstance.remove(existingInFlush);
                isReceivingUpdate.current = false;
              } else {
                return;
              }
            }

            const maxImageSize = Math.min(320, canvasInstance.getWidth() * 0.35, canvasInstance.getHeight() * 0.35);
            const scale = Math.min(maxImageSize / img.width, maxImageSize / img.height, 1);
            const centerLeft = Math.round((canvasInstance.getWidth() / 2) - (img.width * scale / 2));
            const centerTop = Math.round((canvasInstance.getHeight() / 2) - (img.height * scale / 2));

            img.set({
              left: centerLeft,
              top: centerTop,
              id: data.imageId,
              scaleX: scale,
              scaleY: scale
            });

            // Apply buffered position from the generating client if available
            const bufferedPos = pendingImagePositionsRef.current[data.imageId];
            if (bufferedPos) {
              const safePos = { ...bufferedPos };
              delete safePos.src;
              delete safePos.type;
              img.set(safePos);
              delete pendingImagePositionsRef.current[data.imageId];
            }

            try {
              isReceivingUpdate.current = true;
              canvasInstance.add(img);

              const pendingLockSocketId = pendingLocksRef.current?.[data.imageId];
              if (pendingLockSocketId && pendingLockSocketId !== socket.id) {
                img.set({
                  _originalOpacity: img.opacity || 1,
                  _originalStroke: img.stroke,
                  _originalStrokeWidth: img.strokeWidth || 0,
                  selectable: false,
                  evented: false,
                  opacity: 0.5,
                  _lockedBy: pendingLockSocketId
                });
                delete pendingLocksRef.current[data.imageId];
              }

              canvasInstance.renderAll();
              advanceWatermarkContiguously(data?.eventId);
            } finally {
              isReceivingUpdate.current = false;
            }
          }, { crossOrigin: 'anonymous' });
        }
      });
      pendingUpdatesRef.current = []; // Clear the queue
    };

    socket.on('sync_transient_ledger', (ledgerEvents) => {
      if (!canvasRef.current) return;

      // Merge: Older ledger events FIRST, then newer live network events
      if (ledgerEvents && ledgerEvents.length > 0) {
        // If we are a fresh client joining late, jump our baseline to just before the ledger starts
        if (serverWatermarkRef.current === 0) {
          serverWatermarkRef.current = ledgerEvents[0].eventId - 1;
        }
        pendingUpdatesRef.current = [...ledgerEvents, ...pendingUpdatesRef.current];
      }

      flushEventBuffer(canvasRef.current);
      applyActiveLocks(pendingLocksRef?.current || {});

      // Resolve loading state
      isBoardLoadingRef.current = false;
      setIsBoardLoading(false);
    });

    const loadBoard = async () => {
      fetch(`${process.env.REACT_APP_BACKEND_URL}/api/board/${roomCode}/load`)
        .then(res => {
          if (!res.ok) return null;
          return res.json();
        })
        .then(data => {
          if (!isMounted) return; 

          if (data && data.canvasState) {
            let parsedState = typeof data.canvasState === 'string' ? JSON.parse(data.canvasState) : data.canvasState;

            if (parsedState && parsedState.objects) {
              parsedState.objects.forEach(obj => {
                if (obj.type === 'image') {
                  obj.crossOrigin = 'anonymous';
                }
              });
            }

            canvas.loadFromJSON(parsedState, () => {
              if (!isMounted) return; 
              canvas.renderAll();
              applyActiveLocks(pendingLocksRef?.current || {});

              socket.emit('request_transient_ledger', roomCode);
            });
          } else {
            // Board doesn't exist in DB yet, but we MUST fetch the transient ledger for late joiners!
            socket.emit('request_transient_ledger', roomCode);
          }
        })
        .catch(err => {
          console.error("Failed to load board:", err);
          if (isMounted) {
            // Even on network error, try to fetch the live ledger
            socket.emit('request_transient_ledger', roomCode);
          }
        });
    };
    loadBoard();

    return () => {
      isMounted = false;
      throttledMove.cancel();
      window.removeEventListener('keydown', handleKeyDown);
      socket.disconnect();
      canvas.dispose();
      window.CANVAS_ACTIVE_TOOL = 'select';
    };
  }, [roomCode]);

  useEffect(() => {
    // Single source of truth for the global tool flag
    window.CANVAS_ACTIVE_TOOL = activeTool;

    if (!canvasRef.current) return;
    
    // Clean, single declarations
    const isShapeTool = ['rect', 'circle', 'line', 'text'].includes(activeTool);
    const shouldDisableSelection = isShapeTool || activeTool === 'pen' || activeTool === 'eraser';

    if (activeTool === 'pen' || activeTool === 'eraser') {
      canvasRef.current.isDrawingMode = true;
      canvasRef.current.freeDrawingBrush.color = activeTool === 'eraser' ? '#ffffff' : brushColor;
      canvasRef.current.freeDrawingBrush.width = brushWidth;
    } else {
      canvasRef.current.isDrawingMode = false;
    }
    
    canvasRef.current.selection = !shouldDisableSelection;
    // ONLY skip targeting for the Pen tool so Eraser can still find objects to click
    canvasRef.current.skipTargetFind = activeTool === 'pen';
    
    canvasRef.current.forEachObject((obj) => {
      if (obj._lockedBy) return;
      
      obj.set({
        selectable: !shouldDisableSelection,
        evented: activeTool === 'eraser' ? true : !shouldDisableSelection
      });
    });
    
    canvasRef.current.discardActiveObject();
    canvasRef.current.renderAll();

    return () => { window.CANVAS_ACTIVE_TOOL = 'select'; };
  }, [activeTool, brushColor, brushWidth]);

  // ── PHASE 5: HIMANSHU WIRES handleSave HERE ───────────────────
  const handleSave = async () => {
    setIsSaving(true);
    const canvasJSON = canvasRef.current.toJSON(['crossOrigin', 'id', 'eventId', '_lockedBy', '_originalOpacity', '_originalStroke', '_originalStrokeWidth']);
    
    // Scrub ephemeral lock state to keep the DB clean
    if (canvasJSON && canvasJSON.objects) {
      canvasJSON.objects.forEach(obj => {
        // Universally restore interactivity to prevent transient UI state leaks (e.g. from pen tool)
        obj.selectable = true;
        obj.evented = true;

        // Restore visual properties if the object was actively locked
        if (obj._lockedBy) {
          obj.opacity = obj._originalOpacity || 1;
          if (obj._originalStroke !== undefined) obj.stroke = obj._originalStroke;
          if (obj._originalStrokeWidth !== undefined) obj.strokeWidth = obj._originalStrokeWidth;
        }

        // Scrub ephemeral properties from the database payload
        delete obj._lockedBy;
        delete obj._originalOpacity;
        delete obj._originalStroke;
        delete obj._originalStrokeWidth;
      });
    }

    // Add Timestamp for Concurrency Guard
    const payload = { 
      canvasState: canvasJSON,
      timestamp: Date.now(),
      watermark: serverWatermarkRef.current
    };
    const jsonString = JSON.stringify(payload);
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);

    if (sizeInMB > 15) {
      alert(`Cannot save: Board is ${sizeInMB.toFixed(1)}MB. The maximum size is 15MB. Please remove some AI images.`);
      setIsSaving(false);
      return;
    }

    // 4. Send to server
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/board/${roomCode}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonString
      });
      alert('Board Saved!');
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save board.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      backgroundColor: '#f3f4f6', // Soft grey "desk" background
      minHeight: '100vh', 
      paddingTop: '40px',
      overflowX: 'hidden'
    }}>
      <Toolbar 
        isSaving={isSaving}
        activeTool={activeTool} 
        setActiveTool={setActiveTool} 
        onSave={handleSave} 
        handleUndo={handleUndo} 
        handleRedo={handleRedo} 
        brushColor={brushColor} 
        setBrushColor={setBrushColor} 
        brushWidth={brushWidth} 
        setBrushWidth={setBrushWidth} 
      />
      <AIPromptPanel roomCode={roomCode} />
      <div style={{ 
        position: 'relative', 
        width: '1200px', 
        height: '700px',
        backgroundColor: '#ffffff', // Pure white paper
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)', // Drop shadow
        marginTop: '20px', // Space below toolbar
        borderRadius: '8px' // Optional: slightly rounded corners for modern feel
      }}>
        {isBoardLoading && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.9)', zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <div className="spinner" style={{ width: '50px', height: '50px', border: '5px solid #ccc', borderTopColor: '#333', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <h2 style={{ marginTop: '20px', color: '#333' }}>Loading Workspace...</h2>
            <p style={{ color: '#666' }}>Downloading AI assets and synchronizing state</p>
          </div>
        )}
        <canvas id="canvas-el" width={1200} height={700} />
      </div>
    </div>
  );
};

export default Canvas;
