
const fs = require('fs');
const path = require('path');
const net = require('net');

console.log('🔍 Stack62 Diagnostic Check\n');

// Step 1: Check Node.js
console.log('1. Checking Node.js...');
console.log('   Node.js version:', process.version);
console.log('   ✅ Node.js is installed\n');

// Step 2: Check project files
console.log('2. Checking project files...');
const requiredFiles = [
  'package.json',
  '.env',
  'src/main.ts',
  'src/app.module.ts'
];

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ ${file} found`);
  } else {
    console.log(`   ❌ ${file} NOT found`);
  }
});
console.log();

// Step 3: Check node_modules
console.log('3. Checking node_modules...');
const nodeModulesPath = path.join(__dirname, 'node_modules');
const nodeModulesExists = fs.existsSync(nodeModulesPath);
console.log(`   node_modules exists: ${nodeModulesExists ? '✅ Yes' : '❌ No'}`);

const packageLockExists = fs.existsSync(path.join(__dirname, 'package-lock.json'));
console.log(`   package-lock.json exists: ${packageLockExists ? '✅ Yes' : '❌ No'}`);
console.log();

// Step 4: Check PostgreSQL and Redis connectivity
console.log('4. Checking database connectivity...');

async function checkPort(host, port, name) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    
    socket.on('connect', () => {
      console.log(`   ✅ ${name} is running on ${host}:${port}`);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      console.log(`   ❌ ${name} is NOT running on ${host}:${port}`);
      resolve(false);
    });
    
    socket.on('timeout', () => {
      console.log(`   ❌ ${name} connection timeout on ${host}:${port}`);
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

(async () => {
  await checkPort('localhost', 5432, 'PostgreSQL');
  await checkPort('localhost', 6379, 'Redis');
  console.log();
  
  // Step 5: Check .env file
  console.log('5. Checking .env file...');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('   ✅ .env file found. Contents:');
    console.log('   ------------------------------');
    console.log(envContent.split('\n').map(line => '   ' + line).join('\n'));
    console.log('   ------------------------------\n');
  } else {
    console.log('   ❌ .env file NOT found\n');
  }
  
  console.log('📋 Diagnostic complete!');
  console.log('\nNext steps:');
  console.log('1. Make sure PostgreSQL and Redis are running');
  console.log('2. Install dependencies with: node start-backend.js');
})();
