require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function run() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const modelName = 'gemini-2.5-flash-preview';
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent('Reply with OK');
    const response = await result.response;
    console.log('SUCCESS:', response.text());
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.status) console.error('STATUS:', err.status);
    console.error('STACK:', err.stack.split('\n').slice(0, 3).join('\n'));
    
    console.log('RETRYING with gemini-2.5-flash...');
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent('Reply with OK');
        const response = await result.response;
        console.log('SUCCESS (RETRY):', response.text());
    } catch (err2) {
        console.error('ERROR (RETRY):', err2.message);
        if (err2.status) console.error('STATUS (RETRY):', err2.status);
    }
  }
}
run();
