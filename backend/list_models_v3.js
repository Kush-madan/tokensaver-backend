const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.models) {
        process.stdout.write('FIRST_20_MODELS:\n');
        const models = data.models.slice(0, 20);
        models.forEach(m => process.stdout.write(m.name + '\n'));
        
        const flashModel = data.models.find(m => 
            m.name.includes('flash') && 
            m.supportedGenerationMethods && 
            m.supportedGenerationMethods.includes('generateContent')
        );
        
        if (flashModel) {
            process.stdout.write('FLASH_MODEL_ID:' + flashModel.name + '\n');
        } else {
            process.stdout.write('FLASH_MODEL_ID:not found\n');
        }
    } else {
        process.stdout.write('Error or no models found: ' + JSON.stringify(data) + '\n');
    }
  } catch (err) {
    process.stderr.write(err.message + '\n');
  }
}
listModels();
