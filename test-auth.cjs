const { authenticate } = require('/app/apps/web/.next/server/app/login/page.js');

async function main() {
  try {
    const result = await authenticate('admin', 'admin123');
    console.log('Result:', result);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
