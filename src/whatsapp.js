const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeLib = require('qrcode');
const fs = require('fs');

let client;
let io;
let qrCode = null;
let clientStatus = 'disconnected';

const initWhatsApp = (socketIO) => {
    io = socketIO;
    console.log('Initializing WhatsApp client...');
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_STORAGE_PATH || './auth_wwebjs' }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        },
    });

    client.on('qr', async (qr) => {
        console.log('QR Code for authentication:');
        qrcode.generate(qr, { small: true });
        qrCode = qr;
        clientStatus = 'awaiting-authentication';
        try {
            const qrDataURL = await qrcodeLib.toDataURL(qr);
            io.emit('qr', qrDataURL);
            io.emit('status', 'QR Code Ready');
        } catch (err) {
            console.error('Failed to generate QR data URL:', err);
            io.emit('status', 'Error');
        }
    });

    client.on('ready', async () => {
        console.log('Successfully connected to WhatsApp!');
        clientStatus = 'connected';
        qrCode = null;
        io.emit('status', 'Connected');
        const recipient = '256769030882@c.us';
        const message = 'Hello! This is an automated message sent upon successful connection.';
        try {
            await client.sendMessage(recipient, message);
            console.log(`Message sent to ${recipient}`);
        } catch (err) {
            console.error('Failed to send test message:', err);
        }
    });

    client.on('auth_failure', (msg) => {
        console.error('Authentication failed:', msg);
        clientStatus = 'auth-failure';
        fs.rmSync(process.env.WWEBJS_STORAGE_PATH || './auth_wwebjs', { recursive: true, force: true });
        console.log('Cleared session data. Retrying in 10 seconds...');
        io.emit('status', 'Authentication Failure');
        setTimeout(() => client.initialize(), 10000);
    });

    client.on('disconnected', (reason) => {
        console.log('Disconnected. Reason:', reason);
        clientStatus = 'disconnected';
        if (reason === 'LOGOUT' || reason === 'BANNED') {
            fs.rmSync(process.env.WWEBJS_STORAGE_PATH || './auth_wwebjs', { recursive: true, force: true });
            console.log('Cleared session data.');
        }
        console.log('Reconnecting in 10 seconds...');
        io.emit('status', 'Disconnected');
        setTimeout(() => client.initialize(), 10000);
    });

    client.on('error', (err) => {
        console.error('Client error:', err);
        clientStatus = 'error';
        io.emit('status', 'Error');
    });

    client.on('message', (msg) => {
        console.log('Received message:', msg.body);
    });

    let retries = 0;
    const maxRetries = 3;

    async function startWithRetry() {
        try {
            await client.initialize();
            retries = 0;
        } catch (err) {
            console.error('Failed to initialize client:', err);
            clientStatus = 'error';
            io.emit('status', 'Error');
            if (retries < maxRetries) {
                retries++;
                const delay = Math.min(60000, 10000 * Math.pow(2, retries));
                console.log(`Retrying (${retries}/${maxRetries}) in ${delay / 1000} seconds...`);
                setTimeout(startWithRetry, delay);
            } else {
                console.error('Max retries reached. Waiting 30 minutes before retrying...');
                fs.rmSync(process.env.WWEBJS_STORAGE_PATH || './auth_wwebjs', { recursive: true, force: true });
                retries = 0;
                setTimeout(startWithRetry, 30 * 60 * 1000);
            }
        }
    }

    fs.rmSync(process.env.WWEBJS_STORAGE_PATH || './auth_wwebjs', { recursive: true, force: true });
    console.log('Cleared session data. Starting WhatsApp connection...');
    startWithRetry();

    return client;
};

const getWhatsAppClient = () => {
    if (!client) {
        throw new Error('WhatsApp client is not initialized.');
    }
    return client;
};

const sendMessage = async (to, message) => {
    const client = getWhatsAppClient();
    try {
        const cleanNumber = to.replace(/[^0-9]/g, '');
        if (!cleanNumber || cleanNumber.length < 10) {
            throw new Error(`Invalid phone number: ${to}`);
        }
        const chatId = cleanNumber.includes('@c.us') ? cleanNumber : `${cleanNumber}@c.us`;

        const state = await client.getState();
        if (state !== 'CONNECTED') {
            throw new Error(`Client not ready, current state: ${state}`);
        }

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            throw new Error(`Number ${to} is not registered on WhatsApp`);
        }

        console.log(`Sending message to ${chatId}: ${message}`);
        const result = await client.sendMessage(chatId, message);
        console.log(`Message sent successfully to ${chatId}, ID: ${result.id.id}`);
        return { success: true, messageId: result.id.id, to };
    } catch (error) {
        console.error(`Failed to send message to ${to}:`, error);
        return { success: false, to, error: error.message };
    }
};

const sendBulkMessage = async (numbers, message) => {
    const results = [];
    for (const number of numbers) {
        const result = await sendMessage(number, message);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
    }
    return results;
};

const getConnectionStatus = async () => {
    try {
        const status = await client.getState();
        return status || clientStatus;
    } catch (err) {
        console.error('Error getting connection status:', err);
        return clientStatus;
    }
};

const getQRCode = async () => {
    if (clientStatus !== 'awaiting-authentication' || !qrCode) {
        return null;
    }
    try {
        const qrDataURL = await qrcodeLib.toDataURL(qrCode);
        return qrDataURL;
    } catch (err) {
        console.error('Failed to generate QR data URL:', err);
        throw err;
    }
};

const disconnect = async () => {
    const client = getWhatsAppClient();
    try {
        await client.logout();
        clientStatus = 'disconnected';
        io.emit('status', 'Disconnected');
        fs.rmSync(process.env.WWEBJS_STORAGE_PATH || './auth_wwebjs', { recursive: true, force: true });
        console.log('Cleared session data. Client disconnected.');
    } catch (err) {
        console.error('Error during logout:', err);
        throw err;
    }
};

module.exports = {
    initWhatsApp,
    sendMessage,
    sendBulkMessage,
    getConnectionStatus,
    getQRCode,
    disconnect
};