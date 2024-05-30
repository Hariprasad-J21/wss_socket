const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const admin = require("firebase-admin");
const stream = require("stream");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const wav = require("wav");
const fs = require("fs");

const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin SDK
const serviceAccount = require("./store-voice-firebase-adminsdk-4ps9i-56b5cdd10e.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "store-voice.appspot.com",
});

const bucket = admin.storage().bucket();

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const audioFiles = [];
const clients = new Map();

// Function to ensure the directory exists
const ensureDirectoryExistence = (filePath) => {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
};

wss.on("connection", (ws) => {
  console.log("WebSocket connected");

  const clientId = uuidv4();
  clients.set(ws, { clientId });

  let isDeviceIdReceived = false;

  ws.on("message", async (message) => {
    const clientInfo = clients.get(ws);

    if (!isDeviceIdReceived) {
      const deviceId = message.toString().trim();
      if (deviceId) {
        clientInfo.deviceId = deviceId;
        isDeviceIdReceived = true;
        console.log(`Received device ID from client ${clientId}: ${deviceId}`);
      } else {
        console.error(
          `Empty or invalid device ID received from client ${clientId}`
        );
        ws.send("Error: Empty or invalid device ID received");
        return;
      }
    } else if (Buffer.isBuffer(message) && clientInfo.deviceId) {
      const timestamp = new Date();
      console.log(
        `Received binary message from client ${clientInfo.clientId} at ${timestamp}`
      );

      const fileName = `data_${clientInfo.deviceId}_${Date.now()}.wav`;
      const filePath = path.join(__dirname, "audio_files", fileName);

      // Ensure the directory exists
      ensureDirectoryExistence(filePath);

      const fileWriter = new wav.FileWriter(filePath, {
        sampleRate: 6000, // Sample Rate: 44100 Hz
        channels: 1, // Channels: Mono
        bitDepth: 16, // Bit Depth: 16-bit
        endianness: "LE", // Byte Order: Little-endian
      });

      fileWriter.write(message);
      fileWriter.end();

      fileWriter.on("finish", async () => {
        console.log(`Audio file written to ${filePath}`);

        // Store metadata of the file
        audioFiles.push({
          timestamp,
          fileName,
          deviceId: clientInfo.deviceId,
        });

        // Upload the WAV file to Firebase Storage
        try {
          await bucket.upload(filePath);
          console.log(`WAV file uploaded to Firebase Storage`);
          ws.send(`WAV file successfully uploaded to Firebase Storage`);
        } catch (error) {
          console.error(
            `Failed to upload WAV file to Firebase Storage:`,
            error
          );
          ws.send(`Error: Failed to upload WAV file to Firebase Storage`);
        }

        // Delete the local WAV file
        fs.unlinkSync(filePath);
      });

      fileWriter.on("error", (error) => {
        console.error(`Error writing WAV file:`, error);
        ws.send(`Error: Failed to write WAV file`);
      });
    } else {
      console.log(
        `Unexpected message type or missing device ID from client ${clientId}:`,
        message
      );
    }
  });

  ws.on("close", () => {
    console.log(
      `WebSocket disconnected for client ${clients.get(ws).clientId}`
    );
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error(
      `WebSocket error for client ${clients.get(ws).clientId}:`,
      err
    );
  });
});

app.get("/files", async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    const fileMetadata = files.map((file) => {
      const fileNameParts = file.name.split("_");
      return {
        name: file.name,
        timestamp: new Date(parseInt(fileNameParts[2].split(".")[0])),
        deviceId: fileNameParts[1],
      };
    });
    res.render("files", { audioFiles: fileMetadata, bucketName: bucket.name });
  } catch (err) {
    console.error("Error fetching files from Firebase Storage:", err);
    res.status(500).send("Internal server error");
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
