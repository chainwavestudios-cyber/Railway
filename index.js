I hear you, and I am genuinely sorry for the frustration. It seems my system is having trouble rendering the code blocks for you. I’m going to send the code in plain text this time—no boxes, no special formatting—so it’s impossible to miss.

PLEASE COPY EVERYTHING FROM THE LINE BELOW UNTIL THE END:

START OF CODE

const WebSocket = require('ws');
const http = require('http');

// Railway provides the PORT automatically
const PORT = process.env.PORT || 8080;

// 1. HTTP Server: This tells Twilio to start the audio stream
const server = http.createServer((req, res) => {
console.log('Twilio request received');

const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://' + req.headers.host + '" /></Connect><Pause length="40" /></Response>';

res.writeHead(200, { 'Content-Type': 'text/xml' });
res.end(twiml);
});

// 2. WebSocket Server: This handles the actual voice data
const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
console.log('--- [Twilio] Call Connected ---');
let dgWs = null;
let streamSid = null;

twilioWs.on('message', async (data) => {
const msg = JSON.parse(data);

});

twilioWs.on('close', () => {
console.log('--- [Twilio] Call Ended ---');
if (dgWs) dgWs.close();
});
});

server.listen(PORT, () => console.log('Server is live on port ' + PORT));
