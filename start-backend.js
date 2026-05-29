
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Stack62 Backend...\n');

// Determine npm path - use npm.cmd on Windows
const npmPath = path.join('C:', 'Program Files', 'nodejs', 'npm.cmd');

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function main() {
  try {
    // Step 1: Check if node_modules exists
    const fs = require('fs');
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
      console.log('📦 Installing dependencies...');
      await runCommand(npmPath, ['install'], __dirname);
      console.log('✅ Dependencies installed!\n');
    }

    // Step 2: Start the backend
    console.log('🔥 Starting backend server...');
    console.log('📡 Backend will be available at: http://localhost:3000');
    console.log('📖 Swagger docs: http://localhost:3000/v1/docs\n');

    const dev = spawn(npmPath, ['run', 'start:dev'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });

    dev.on('close', (code) => {
      if (code !== 0) {
        console.error('\n❌ Backend stopped unexpectedly');
      }
    });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
