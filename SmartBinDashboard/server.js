const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const http = require('http'); // Required wrapper for Socket.io
const { Server } = require('socket.io'); // Required for real-time UI web sockets
const { SerialPort } = require('serialport'); // Serial communication library for ESP32-CAM
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize Firebase Admin (Ensure serviceAccountKey.json is in your root project folder)
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Middleware Configurations
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- SERVE MAIN DASHBOARD ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API ENDPOINTS (Preserved Core Repository Routing) ---
app.get('/api/bin-status', async (req, res) => {
    try {
        const snapshot = await db.collection('bin_status').orderBy('timestamp', 'desc').limit(1).get();
        if (snapshot.empty) {
            return res.status(404).json({ message: 'No data found' });
        }
        const data = snapshot.docs[0].data();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/update-bin', async (req, res) => {
    try {
        const { fill_level, status } = req.body;
        const newData = {
            fill_level: parseInt(fill_level),
            status: status,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('bin_status').add(newData);

        // Broadcast manual API updates to the dashboard interface
        io.emit('binStatusUpdated', newData);

        res.status(200).json({ message: 'Success', data: newData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ESP32-CAM SERIAL INTEGRATION ---
const serialPortPath = 'COM3'; // Replace with your hardware's active COM port later
let mySerialPort;

try {
    mySerialPort = new SerialPort({ path: serialPortPath, baudRate: 115200 });
    const parser = mySerialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    console.log(`[SERIAL] Connection established successfully on port: ${serialPortPath}`);

    // Continuously listen to lines printed by the ESP32-CAM AI system
    parser.on('data', async (data) => {
        const cleanData = data.trim().toUpperCase();
        console.log(`[ESP32-CAM RAW DATA]: ${cleanData}`);

        let trashType = '';
        if (cleanData === "BIODEGRADABLE" || cleanData === "BIO") {
            trashType = 'biodegradable';
        } else if (cleanData === "NON-BIODEGRADABLE" || cleanData === "NON-BIO") {
            trashType = 'non_biodegradable';
        }

        if (trashType) {
            const logData = {
                type: trashType,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };

            // 1. Automatically push logs into Firebase Firestore "waste_logs" collection
            try {
                await db.collection('waste_logs').add(logData);
                console.log(`[FIREBASE] New ${trashType} entry successfully logged to Firestore.`);
            } catch (dbError) {
                console.error('[FIREBASE ERROR] Failed to write document:', dbError.message);
            }

            // 2. Transmit real-time event to the frontend UI without reloading the page
            io.emit('trashDetected', {
                type: trashType,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    });

} catch (error) {
    console.log(`[SERIAL NOTICE] Port ${serialPortPath} is unavailable. System running in cloud-only database mode.`);
}

// Global Socket.io Stream Connection Monitor
io.on('connection', (socket) => {
    console.log('[SOCKET] Client device connected to the live stream dashboard panel.');
});

// Run HTTP wrapper listener instead of raw express to bundle web socket framework
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access dashboard at: http://localhost:${PORT}`);
});
