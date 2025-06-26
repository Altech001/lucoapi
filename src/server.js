const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const { initWhatsApp, sendMessage, sendBulkMessage, getConnectionStatus, getQRCode, disconnect } = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: ["https://<your-frontend-name>.onrender.com", "http://localhost:5173"], // Replace with your Render frontend URL
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 8001;

// Middleware
app.use(express.json());
app.use(cors({
    origin: ["https://<your-frontend-name>.onrender.com", "http://localhost:5173"], // Replace with your Render frontend URL
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

// Initialize WhatsApp client with Socket.IO
const client = initWhatsApp(io);

// API Endpoints
app.get('/api/status', async (req, res) => {
    try {
        const status = await getConnectionStatus();
        res.json({ status });
    } catch (err) {
        console.error('Error getting status:', err);
        res.status(500).json({ error: 'Failed to get status', details: err.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { recipient, message } = req.body;
    if (!recipient || !message) {
        return res.status(400).json({ error: 'Recipient and message are required' });
    }
    try {
        const result = await sendMessage(recipient, message);
        if (result.success) {
            res.json({ success: true, messageId: result.messageId, recipient });
        } else {
            res.status(500).json({ error: 'Failed to send message', details: result.error });
        }
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message', details: err.message });
    }
});

app.post('/api/send-bulk', async (req, res) => {
    const { numbers, message } = req.body;
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !message) {
        return res.status(400).json({ error: 'A non-empty array of "numbers" and a "message" are required' });
    }
    try {
        const results = await sendBulkMessage(numbers, message);
        res.json({ results });
    } catch (err) {
        console.error('Error sending bulk messages:', err);
        res.status(500).json({ error: 'Failed to send bulk messages', details: err.message });
    }
});

app.post('/api/disconnect', async (req, res) => {
    try {
        await disconnect();
        res.status(200).json({ success: true, message: 'Disconnecting...' });
    } catch (err) {
        console.error('Error disconnecting:', err);
        res.status(500).json({ error: 'Failed to disconnect', details: err.message });
    }
});

server.listen(port, () => {
    console.log(`Express server running on port ${port}`);
});

const gracefulShutdown = (signal) => {
    console.log(`[${signal}] Shutting down gracefully...`);
    server.close(() => {
        console.log('HTTP server closed.');
        client.destroy()
            .then(() => {
                console.log('WhatsApp client destroyed.');
                process.exit(0);
            })
            .catch(err => {
                console.error('Error destroying WhatsApp client:', err);
                process.exit(1);
            });
    });
    setTimeout(() => {
        console.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));