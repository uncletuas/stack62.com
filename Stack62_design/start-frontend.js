
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Stack62 Frontend...\n');

// Use npm.cmd on Windows
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
      console.log('📦 Installing frontend dependencies...');
      await runCommand(npmPath, ['install'], __dirname);
      console.log('✅ Frontend dependencies installed!\n');
    }

    // Step 2: Start the frontend
    console.log('🔥 Starting frontend dev server...');
    console.log('🎨 Frontend will be available at: http://localhost:5173\n');

    const dev = spawn(npmPath, ['run', 'dev'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });

    dev.on('close', (code) => {
      if (code !== 0) {
        console.error('\n❌ Frontend stopped unexpectedly');
      }
    });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
