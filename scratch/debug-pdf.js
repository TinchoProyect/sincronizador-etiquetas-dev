const path = require('path');
const { Writable } = require('stream');
require('dotenv').config();

// Require the controller
const controller = require('../src/logistica/controllers/cuentaCorrienteController');

class MockResponse extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.statusVal = 200;
    this.sentData = null;
    this.chunks = [];
  }
  
  setHeader(name, value) {
    this.headers[name] = value;
  }
  
  status(code) {
    this.statusVal = code;
    return this;
  }
  
  _write(chunk, encoding, callback) {
    this.chunks.push(chunk);
    callback();
  }
  
  send(data) {
    this.sentData = data;
    console.log(`res.send() called. Status: ${this.statusVal}`);
    console.log('Headers:', this.headers);
    if (Buffer.isBuffer(data)) {
      console.log(`Sent data is a Buffer of size: ${data.length} bytes.`);
    } else if (typeof data === 'string') {
      console.log(`Sent data (string, first 200 chars): "${data.substring(0, 200)}"`);
    } else {
      console.log(`Sent data:`, data);
    }
  }
  
  end(chunk) {
    super.end(chunk);
    if (chunk) {
      this.chunks.push(chunk);
    }
    const fullBuffer = Buffer.concat(this.chunks);
    console.log(`res.end() called. Status: ${this.statusVal}. Stream generated PDF size: ${fullBuffer.length} bytes.`);
  }
}

async function testMovimiento(id) {
  console.log(`\n=================== TESTING MOVEMENT ID: ${id} ===================`);
  
  const req = {
    params: { movimientoId: String(id) }
  };
  
  const res = new MockResponse();

  try {
    await controller.generarComprobantePdf(req, res);
    // Give some time for stream compilation if it's piping
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    console.error('CRITICAL: Controller threw an unhandled exception:', err);
  }
}

async function run() {
  await testMovimiento(186); // Payment
  await testMovimiento(185); // Invoice
}

run();
