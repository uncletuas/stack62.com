
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const worktreeDir = path.join(__dirname, '.claude', 'worktrees', 'infallible-hypatia-f91871');

console.log('🚀 Using the complete worktree project!\n');
console.log('Worktree directory:', worktreeDir);

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    // On Windows, use npx or npm directly without path issues
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    
    child.on('error', reject);
  });
}

async function main() {
  try {
    // Step 1: Copy .env.example to .env in worktree
    const envExamplePath = path.join(worktreeDir, '.env.example');
    const envPath = path.join(worktreeDir, '.env');
    
    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      console.log('📋 Copying .env.example to .env...');
      fs.copyFileSync(envExamplePath, envPath);
      
      // Update .env for local development
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace('DATABASE_HOST=postgres', 'DATABASE_HOST=localhost');
      envContent = envContent.replace('REDIS_HOST=redis', 'REDIS_HOST=localhost');
      fs.writeFileSync(envPath, envContent);
      console.log('✅ .env file created and configured!\n');
    }

    // Step 2: Install dependencies
    console.log('📦 Installing worktree dependencies...');
    await runCommand('npm', ['install'], worktreeDir);

    // Step 3: Start the backend
    console.log('\n🔥 Starting backend from worktree...');
    const dev = spawn('npm', ['run', 'start:dev'], {
      cwd: worktreeDir,
      stdio: 'inherit',
      shell: true
    });

    dev.on('close', (code) => {
      console.log(`Backend exited with code ${code}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
