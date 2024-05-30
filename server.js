const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

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

const audioChunksDir = path.join(__dirname, "audio_chunks");
if (!fs.existsSync(audioChunksDir)) {
  fs.mkdirSync(audioChunksDir);
}

const clients = new Map();

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
      console.log(`Received binary message from client ${clientInfo.clientId}`);
      const chunkFileName = `${clientInfo.deviceId}_${Date.now()}.wav`;
      const chunkFilePath = path.join(audioChunksDir, chunkFileName);

      fs.writeFile(
        chunkFilePath,
        message,
        { encoding: "binary" },
        async (err) => {
          if (err) {
            console.error(`Error writing audio chunk:`, err);
            ws.send(`Error: Failed to write audio chunk`);
            return;
          }

          console.log(`Audio chunk written to ${chunkFilePath}`);
        }
      );
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

// Concatenate audio chunks and upload to Firebase Storage
setInterval(async () => {
  try {
    const tempFiles = fs.readdirSync(audioChunksDir);
    if (tempFiles.length === 0) return;

    const concatenatedFileName = `concatenated_${Date.now()}.wav`;
    const concatenatedFilePath = path.join(
      __dirname,
      "audio_files",
      concatenatedFileName
    );

    const writeStream = fs.createWriteStream(concatenatedFilePath);

    for (const file of tempFiles) {
      const filePath = path.join(audioChunksDir, file);
      const data = fs.readFileSync(filePath);
      fs.unlinkSync(filePath);
      writeStream.write(data);
    }

    writeStream.end();

    await bucket.upload(concatenatedFilePath);
    console.log(`Concatenated audio file uploaded to Firebase Storage`);

    fs.unlinkSync(concatenatedFilePath);
  } catch (error) {
    console.error(`Error processing audio chunks:`, error);
  }
}, 5000); // Adjust the interval as needed

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
