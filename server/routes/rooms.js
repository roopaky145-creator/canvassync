const express = require('express');
const router = express.Router();
const crypto = require('crypto');

router.post('/create', (req, res) => {
    const roomCode = crypto.randomBytes(4).toString('hex');
    res.json({ roomCode });
});

module.exports = router;
