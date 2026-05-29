
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const worktreeDir = path.join(__dirname, '.claude', 'worktrees', 'infallible-hypatia-f91871', 'Stack62_design');
const npmCmd = path.join('C:', 'Program Files', 'nodejs', 'npm.cmd');

console.log('🚀 Using frontend from worktree!\n');

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  try {
    // Step 1: Copy .env.example to .env
    const envExamplePath = path.join(worktreeDir, '.env.example');
    const envPath = path.join(worktreeDir, '.env');
    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
    }

    // Step 2: Install dependencies
    console.log('📦 Installing frontend dependencies...');
    await runCommand(npmCmd, ['install'], worktreeDir);

    // Step 3: Start the frontend
    console.log('\n🔥 Starting frontend from worktree...');
    const dev = spawn(npmCmd, ['run', 'dev'], {
      cwd: worktreeDir,
      stdio: 'inherit',
      shell: true
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
