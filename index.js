const msg = JSON.parse(data);
if (msg.event === 'start') {
streamSid = msg.start.streamSid;
const apiKey = process.env.DEEPGRAM_API_KEY;
dgWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse?token=' + apiKey);
dgWs.on('open', () => {
dgWs.send(JSON.stringify({
type: 'Settings',
audio: { input: { encoding: 'mulaw', sample_rate: 8000 }, output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' } },
agent: { think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, instructions: 'Keep answers brief.' }, speak: { model: 'aura-2-thalia-en' } }
}));
});
dgWs.on('message', (dgData) => {
if (dgData instanceof Buffer && twilioWs.readyState === 1) {
twilioWs.send(JSON.stringify({ event: 'media', streamSid: streamSid, media: { payload: dgData.toString('base64') } }));
}
});
}
if (msg.event === 'media' && dgWs && dgWs.readyState === 1) {
const audioBuffer = Buffer.from(msg.media.payload, 'base64');
dgWs.send(audioBuffer);
}
