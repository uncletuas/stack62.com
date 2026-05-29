
const { execSync } = require('child_process');

try {
  console.log('Node.js version:', execSync('node --version', { encoding: 'utf8' }).trim());
  console.log('npm version:', execSync('npm --version', { encoding: 'utf8' }).trim());
  console.log('✅ Node.js and npm are available!');
} catch (error) {
  console.error('❌ Error checking versions:', error.message);
}
