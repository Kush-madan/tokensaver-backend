const { GoogleGenerativeAI } = require('@google/genai');
require('dotenv').config();

async function listModels() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY);
    // Note: The @google/genai package might not have a direct models.list on the genAI instance.
    // Usually, you use the GoogleGenerativeAI to get a model.
    // However, the prompt asks to use @google/genai to list available models.
    // Actually, listing models is often done via the Google AI File Manager or specific REST calls, 
    // but some versions/proxies of the client might have it.
    // Let's try the common approach or check documentation if this fails.
    // Usually listModels is on the generativeAI object in newer versions or requires a different client.
    
    // Wait, @google/genai (the official SDK) focuses on generating content. 
    // Listing models is often in the REST API.
    // Let's try a snippet that tries to find them.
    
    const client = genAI; 
    // Testing if listModels exists
    if (typeof genAI.listModels === 'function') {
        const result = await genAI.listModels();
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log('listModels is not a function on GoogleGenerativeAI instance');
    }
  } catch (err) {
    console.error(err);
  }
}
listModels();
