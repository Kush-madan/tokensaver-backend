const BASE_URL = 'https://tokensaver-backend.vercel.app';

async function testEndpoint(endpoint, payload) {
  try {
    const response = await fetch(${BASE_URL}, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log(\?  - PASS\);
    } else {
      console.log(\?  - FAIL (Status: )\);
    }
  } catch (error) {
    console.log(\?  - FAIL (Error: )\);
  }
}

async function runTests() {
  console.log('Starting endpoint tests...');
  
  await testEndpoint('/api/compress', { text: 'Test text to compress' });
  await testEndpoint('/api/summarize', { text: 'Test text to summarize' });
  await testEndpoint('/api/split', { text: 'Test text to split', maxTokens: 100 });
}

runTests();
