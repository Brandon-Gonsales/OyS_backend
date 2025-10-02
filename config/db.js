// --- SECCIÓN 1: IMPORTACIONES ---
const admin = require('firebase-admin');
const { VertexAI } = require('@google-cloud/vertexai');
const { Storage } = require('@google-cloud/storage');
const { Pinecone } = require('@pinecone-database/pinecone');

// --- SECCIÓN 2: INICIALIZACIÓN DE SERVICIOS ---

// --- GOOGLE CLOUD ---
// Inicializa Firebase Admin para acceder a Firestore. La autenticación es automática.
admin.initializeApp();
const db = admin.firestore();

// Inicializa el cliente principal de Vertex AI.
const vertex_ai = new VertexAI({
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: "us-central1" // Usamos us-central1 para máxima compatibilidad de modelos.
});

// Obtiene los modelos generativos que usaremos para chat y visión.
const generativeModel = vertex_ai.getGenerativeModel({ model: "gemini-2.5-pro" });
const visionGenerativeModel = vertex_ai.getGenerativeModel({ model: "gemini-2.5-pro" });

// Inicializa el cliente para interactuar con Cloud Storage.
const storage = new Storage();
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);


// --- PINECONE ---
// Inicializa el cliente de Pinecone con la API Key del .env.
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});
// Apunta al índice específico que estás utilizando.
const pineconeIndex = pinecone.index('chat-rag');
console.log("Conectado y listo para usar el índice de Pinecone: 'chat-rag'.");


// --- SECCIÓN 3: EXPORTACIONES ---
// Hacemos que todos los servicios estén disponibles para el resto de la aplicación.
module.exports = {
    db,                     // Cliente de Firestore
    admin,                  // SDK de Firebase Admin (para funciones como FieldValue)
    generativeModel,        // Modelo de IA para generar texto
    visionGenerativeModel,  // Modelo de IA para analizar imágenes
    bucket,                 // Nuestro bucket de Cloud Storage
    pineconeIndex           // El índice de Pinecone listo para usar
};