const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const http = require('http'); // Required wrapper for Socket.io
const { Server } = require('socket.io'); // Required for real-time UI web sockets

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
    const data = snapshot.docs.data();
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

// --- DYNAMIC HARDWARE BYPASS DETECTOR FOR CLOUD COMPATIBILITY ---
let SerialPort;
try {
  // Dynamically load SerialPort only if available (Localhost mode)
  SerialPort = require('serialport').SerialPort;
  const { ReadlineParser } = require('@serialport/parser-readline');
  
  const serialPortPath = 'COM3'; 
  const mySerialPort = new SerialPort({ path: serialPortPath, baudRate: 115200 });
  const parser = mySerialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  console.log(`[SERIAL] Connection established successfully on port: ${serialPortPath}`);

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
      const logData = { type: trashType, timestamp: admin.firestore.FieldValue.serverTimestamp() };
      try {
        await db.collection('waste_logs').add(logData);
        console.log(`[FIREBASE] New ${trashType} entry successfully logged to Firestore.`);
      } catch (dbError) {
        console.error('[FIREBASE ERROR] Failed to write document:', dbError.message);
      }
      io.emit('trashDetected', { type: trashType, timestamp: new Date().toLocaleTimeString() });
    }
  });
} catch (e) {
  console.log("[SERIAL NOTICE] Running in cloud production environment. Hardware module bypassed safely.");
}

// Global Socket.io Stream Connection Monitor
io.on('connection', (socket) => {
  console.log('[SOCKET] Client device connected to the live stream dashboard panel.');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
