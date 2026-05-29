
const { spawn } = require('child_process');

console.log('Starting Docker Compose...');
const dockerCompose = spawn('docker-compose', ['up', '--build'], {
  cwd: __dirname,
  stdio: 'inherit'
});

dockerCompose.on('close', (code) => {
  console.log(`Docker Compose exited with code ${code}`);
});
