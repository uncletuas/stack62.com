
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 Setting up Stack62 Backend...\n');

// Use npm.cmd on Windows
const npmCmd = path.join('C:', 'Program Files', 'nodejs', 'npm.cmd');

async function runStep(description, command, args, cwd) {
  console.log(`\n📋 ${description}...`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${description} complete!`);
        resolve();
      } else {
        console.error(`❌ ${description} failed with code ${code}`);
        reject(new Error(`${description} failed`));
      }
    });

    child.on('error', reject);
  });
}

async function main() {
  try {
    // Step 1: Install dependencies
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
      await runStep(
        'Installing backend dependencies',
        npmCmd,
        ['install'],
        __dirname
      );
    } else {
      console.log('✅ node_modules already exists, skipping install');
    }

    // Step 2: Try to build the backend
    await runStep(
      'Building backend',
      npmCmd,
      ['run', 'build'],
      __dirname
    );

    // Step 3: Start the backend in dev mode
    console.log('\n🚀 Starting backend in development mode...');
    const dev = spawn(npmCmd, ['run', 'start:dev'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });

    dev.on('close', (code) => {
      console.log(`\nBackend process exited with code ${code}`);
    });

  } catch (error) {
    console.error('\n💥 Error setting up backend:', error.message);
    process.exit(1);
  }
}

main();
