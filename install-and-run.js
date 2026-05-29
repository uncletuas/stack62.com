
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Installing backend dependencies...');

// First, install dependencies using node to call npm
const install = spawn('node', [
  path.join('C:', 'Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  'install'
], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

install.on('close', (code) => {
  if (code !== 0) {
    console.error('❌ Failed to install dependencies');
    process.exit(1);
  }

  console.log('\n✅ Dependencies installed! Starting backend in dev mode...');

  // Now start the dev server
  const dev = spawn('node', [
    path.join('C:', 'Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'run', 'start:dev'
  ], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  dev.on('close', (code) => {
    if (code !== 0) {
      console.error('❌ Backend stopped unexpectedly');
    }
  });
});
