const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function inspectEnv() {
    const envPath = path.join(__dirname, '../../../.env');
    const envObj = dotenv.parse(fs.readFileSync(envPath));

    console.log('Variables presentes en .env:');
    Object.keys(envObj).forEach(key => {
        const val = envObj[key];
        const preview = val ? (val.length > 15 ? val.slice(0, 8) + '...' + val.slice(-4) : val) : 'EMPTY';
        console.log(` - ${key}: ${preview}`);
    });
}

inspectEnv();
