
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  
  if (req.url === '/v1/auth/register' && req.method === 'POST') {
    res.end(JSON.stringify({
      message: 'Test server working!',
      accessToken: 'test-token-123'
    }));
  } else if (req.url === '/v1/auth/login' && req.method === 'POST') {
    res.end(JSON.stringify({
      message: 'Test server working!',
      accessToken: 'test-token-123'
    }));
  } else if (req.url === '/v1/auth/google/available') {
    res.end(JSON.stringify({ available: false }));
  } else if (req.url === '/v1/docs') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Test Server Running!</h1><p>API endpoints are working!</p>');
  } else {
    res.end(JSON.stringify({
      message: 'Stack62 Test Server',
      status: 'running',
      endpoints: [
        '/v1/auth/register',
        '/v1/auth/login',
        '/v1/auth/google/available',
        '/v1/docs'
      ]
    }));
  }
});

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`🚀 Test Server running at http://localhost:${PORT}`);
  console.log(`📖 Test docs: http://localhost:${PORT}/v1/docs`);
  console.log('\nTry these endpoints:');
  console.log('  GET http://localhost:3000/');
  console.log('  GET http://localhost:3000/v1/auth/google/available');
  console.log('  POST http://localhost:3000/v1/auth/register');
  console.log('  POST http://localhost:3000/v1/auth/login');
});
