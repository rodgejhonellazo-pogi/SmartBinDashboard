const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize Firebase Admin
// On Render: set the FIREBASE_SERVICE_ACCOUNT environment variable (full JSON).
// On localhost: falls back to ./serviceAccountKey.json (do NOT commit this file).
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Parse JSON request bodies and serve the files in the public folder
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main dashboard page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get the latest bin status from Firestore
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

// Save a new bin fill level and notify the dashboard
app.post('/api/update-bin', async (req, res) => {
  try {
    const { fill_level, status } = req.body;
    const newData = {
      fill_level: parseInt(fill_level),
      status: status,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('bin_status').add(newData);

    // Send the update to the dashboard in real time
    io.emit('binStatusUpdated', newData);

    res.status(200).json({ message: 'Success', data: newData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Receive a detection result from the ESP32-CAM over WiFi
app.post('/api/detection', async (req, res) => {
  try {
    // Check the device API key sent in the request header
    const key = req.headers['x-api-key'];
    if (!process.env.DEVICE_API_KEY || key !== process.env.DEVICE_API_KEY) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const { label, bioScore, nonBioScore } = req.body;

    // Convert the label to the waste type used by the dashboard
    let trashType = '';
    const l = String(label || '').toLowerCase();
    if (l === 'biodegradable') {
      trashType = 'biodegradable';
    } else if (l === 'non-biodegradable' || l === 'non_biodegradable') {
      trashType = 'non_biodegradable';
    }

    if (!trashType) {
      return res.status(400).json({ error: 'Invalid label' });
    }

    // Save the detection to the waste log collection
    const logData = {
      type: trashType,
      bioScore: Number(bioScore) || 0,
      nonBioScore: Number(nonBioScore) || 0,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('waste_logs').add(logData);
    console.log(`[DETECTION] ${trashType} logged from ESP32-CAM.`);

    // Send the detection to the dashboard in real time
    io.emit('trashDetected', {
  type: trashType,
  timestamp: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })
});

    res.status(200).json({ message: 'Success' });
  } catch (error) {
    console.error('[DETECTION ERROR]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Read detections from a USB serial port (local use only, skipped on the cloud)
let SerialPort;
try {
  SerialPort = require('serialport').SerialPort;
  const { ReadlineParser } = require('@serialport/parser-readline');

  const serialPortPath = 'COM3';
  const mySerialPort = new SerialPort({ path: serialPortPath, baudRate: 115200 });
  const parser = mySerialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  console.log(`[SERIAL] Connection established successfully on port: ${serialPortPath}`);

  // Handle each line of text received from the board
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

// Log when a dashboard client connects to the live stream
io.on('connection', (socket) => {
  console.log('[SOCKET] Client device connected to the live stream dashboard panel.');
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
