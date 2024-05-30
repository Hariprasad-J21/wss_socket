let ws;
let mediaRecorder;
let chunks = [];
let deviceId;

document.getElementById("connectBtn").addEventListener("click", () => {
  deviceId = document.getElementById("deviceId").value.trim();
  if (!deviceId) {
    alert("Please enter a device ID");
    return;
  }

  ws = new WebSocket(`ws://${location.hostname}:${location.port}`);

  ws.onopen = () => {
    console.log("WebSocket connection opened");
    ws.send(deviceId); // Send device ID as the first message
    console.log("Sent device ID:", deviceId); // Log the device ID being sent
    document.getElementById("startBtn").disabled = false;
  };

  ws.onmessage = (event) => {
    console.log("Message from server:", event.data);
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed");
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
});

document.getElementById("startBtn").addEventListener("click", async () => {
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (e) => {
    chunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: "audio/pcm" });
    chunks = [];
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      const buffer = new Uint8Array(arrayBuffer);
      ws.send(buffer); // Send binary data to the server
    };
    reader.readAsArrayBuffer(blob);
  };

  mediaRecorder.start();
});

document.getElementById("stopBtn").addEventListener("click", () => {
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("startBtn").disabled = false;

  mediaRecorder.stop();
});
