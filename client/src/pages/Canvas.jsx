import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { throttle } from 'lodash';
import { fabric } from 'fabric';

import Toolbar from '../components/Toolbar';

const Canvas = () => {
  const { code: roomCode } = useParams();
  const [activeTool, setActiveTool] = useState('select');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushWidth, setBrushWidth] = useState(2);
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
    const socket = io(process.env.REACT_APP_BACKEND_URL);
    socketRef.current = socket;
    const canvas = new fabric.Canvas('canvas-el');
    canvasRef.current = canvas;

    socket.emit('join_room', roomCode);

    // ── EMIT SIDE ────────────────────────────────────────────────
    canvas.on('object:added', (e) => {
      if (!e.target.id) e.target.set('id', uuidv4());
      if (!isReceivingUpdate.current && !isDrawingShape) {
        socket.emit('canvas_update', { roomCode, objectData: e.target.toJSON(['id']) });
      }
    });

    const throttledMove = throttle((e) => {
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_update', { roomCode, objectData: e.target.toJSON(['id']) });
    }, 50);

    canvas.on('object:moving', throttledMove);

    canvas.on('object:modified', (e) => {
      throttledMove.flush();
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_update', { roomCode, objectData: e.target.toJSON(['id']) });
    });

    canvas.on('object:removed', (e) => {
      if (!e.target.id) return; // guard: never emit delete for objects without an ID
      if (isReceivingUpdate.current) return;
      socket.emit('canvas_delete', { roomCode, objectId: e.target.id });
    });

    canvas.on('path:created', (e) => {
      if (!e.path.id) e.path.set('id', uuidv4());
      lastAddedObjectRef.current = e.path;
      redoObjectRef.current = null;
    });

    canvas.on('mouse:down', (e) => {
      if (window.CANVAS_ACTIVE_TOOL === 'eraser' && e.target) {
        if (!e.target.id) return; // Guard against unsynced objects
        canvas.remove(e.target);
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
        
        window.CANVAS_ACTIVE_TOOL = 'select';
        setActiveTool('select');
        return;
      }

      canvas.discardActiveObject();

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
    socket.on('canvas_update', (data) => {
      if (canvas.getActiveObject()?.id === data.objectData.id) return;
      isReceivingUpdate.current = true;
      const existing = canvas.getObjects().find(o => o.id === data.objectData.id);
      if (existing) {
        try {
          // Fix Fabric.js Line sync bug by forcing coordinate update before bounding box update
          if (data.objectData.type === 'line') {
            existing.set({
              x1: data.objectData.x1,
              y1: data.objectData.y1,
              x2: data.objectData.x2,
              y2: data.objectData.y2
            });
          }
          
          existing.set(data.objectData);
          
          // Re-enforce lock visual state if this object is currently locked by someone else
          if (existing._lockedBy && existing._lockedBy !== socket.id) {
            existing.set({ selectable: false, evented: false, opacity: 0.3 });
          }
          
          existing.setCoords();
          canvas.renderAll();
        } finally {
          isReceivingUpdate.current = false;
        }
      } else {
        fabric.util.enlivenObjects([data.objectData], (objects) => {
          try {
            objects.forEach(obj => canvas.add(obj));
            canvas.renderAll();
          } finally {
            isReceivingUpdate.current = false;
          }
        });
      }
    });

    socket.on('canvas_delete', (data) => {
      isReceivingUpdate.current = true;
      const obj = canvas.getObjects().find(o => o.id === data.objectId);
      if (obj) { canvas.remove(obj); canvas.renderAll(); }
      isReceivingUpdate.current = false;
    });

    // ── PHASE 3: HIMANSHU ADDS LOCKING LISTENERS HERE ────────────
    socket.on('lock_acquired', (data) => {
      if (data.lockedBy === socket.id) return;
      const obj = canvas.getObjects().find(o => o.id === data.object_id);
      if (obj) {
        if (obj.selectable === false) return;
        obj.set({ _originalOpacity: obj.opacity || 1 });
        obj.set({ selectable: false, evented: false, opacity: 0.3, _lockedBy: data.lockedBy });
        canvas.renderAll();
      }
    });

    socket.on('lock_released', (data) => {
      const obj = canvas.getObjects().find(o => o.id === data.object_id);
      if (obj) {
        obj.set({ selectable: true, evented: true, opacity: obj._originalOpacity || 1 });
        canvas.renderAll();
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
            _lockedBy: null 
          });
          requiresRender = true;
        }
      });
      if (requiresRender) canvas.renderAll();
    });

    // ── PHASE 4: HIMANSHU ADDS ai_image_generated LISTENER HERE ──

    // ── PHASE 5: HIMANSHU ADDS loadBoard() CALL HERE ─────────────

    return () => {
      throttledMove.cancel();
      window.removeEventListener('keydown', handleKeyDown);
      socket.disconnect();
      canvas.dispose();
    };
  }, [roomCode]);

  useEffect(() => {
    // Single source of truth for the global tool flag — eliminates stale leaks across remounts
    window.CANVAS_ACTIVE_TOOL = activeTool;

    if (!canvasRef.current) return;
    
    if (activeTool === 'pen' || activeTool === 'eraser') {
      canvasRef.current.isDrawingMode = true;
      canvasRef.current.freeDrawingBrush.color = activeTool === 'eraser' ? '#ffffff' : brushColor;
      canvasRef.current.freeDrawingBrush.width = brushWidth;
    } else {
      canvasRef.current.isDrawingMode = false;
    }

    return () => { window.CANVAS_ACTIVE_TOOL = 'select'; };
  }, [activeTool, brushColor, brushWidth]);

  // ── PHASE 5: HIMANSHU WIRES handleSave HERE ───────────────────
  const handleSave = async () => { /* Himanshu implements Phase 5 */ };

  return (
    <div style={{ position: 'relative' }}>
      <Toolbar 
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
      <canvas id="canvas-el" width={1200} height={700} />
    </div>
  );
};

export default Canvas;
