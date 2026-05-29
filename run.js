
const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Starting Stack62 backend...');

try {
  // Run docker compose up --build -d
  console.log('📦 Building and starting Docker containers...');
  execSync('docker compose up --build -d', {
    cwd: __dirname,
    stdio: 'inherit'
  });

  console.log('\n✅ Backend started successfully!');
  console.log('📡 API: http://localhost:3000');
  console.log('📖 Swagger docs: http://localhost:3000/v1/docs');
  console.log('\n📋 Next steps:');
  console.log('1. Open another terminal in Stack62_design');
  console.log('2. Run: npm run dev');
  console.log('3. Open http://localhost:5173 in your browser');
} catch (error) {
  console.error('\n❌ Error starting backend:', error.message);
  process.exit(1);
}
