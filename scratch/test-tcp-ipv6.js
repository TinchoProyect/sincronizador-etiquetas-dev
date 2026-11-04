const net = require('net');

console.log('📡 Attempting TCP connection to Supabase IPv6 address...');
const socket = net.connect({
  host: '2600:1f1e:90b:a701:17e9:4d0c:46a5:ba2e',
  port: 5432,
  family: 6
});

socket.on('connect', () => {
  console.log('🎉 TCP Connection SUCCESS!');
  socket.end();
  process.exit(0);
});

socket.on('error', (err) => {
  console.error('❌ TCP Connection FAILED:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('⏳ TCP Connection TIMEOUT');
  socket.destroy();
  process.exit(1);
}, 5000);
