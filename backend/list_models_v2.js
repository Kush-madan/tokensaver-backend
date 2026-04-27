const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
require('dotenv').config();

async function listModels() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    // For listing models, we can use the genAI instance or a fetch call since the JS SDK 
    // focuses on Gemini interaction. However, many versions don't expose listModels directly.
    // Let's use the REST API via fetch or check if there's a GoogleGenerativeAIApi equivalent.
    
    const response = await fetch(\https://generativelanguage.googleapis.com/v1beta/models?key=\\);
    const data = await response.json();
    
    if (data.models) {
        console.log('FIRST_20_MODELS:');
        const models = data.models.slice(0, 20);
        models.forEach(m => console.log(m.name));
        
        const flashModel = data.models.find(m => 
            m.name.includes('flash') && 
            m.supportedGenerationMethods.includes('generateContent')
        );
        
        if (flashModel) {
            console.log('FLASH_MODEL_ID:' + flashModel.name);
        } else {
            console.log('FLASH_MODEL_ID:not found');
        }
    } else {
        console.log('Error or no models found:', data);
    }
  } catch (err) {
    console.error(err);
  }
}
listModels();
