// En: backend/config/db.js

// --- SECCIÓN 1: IMPORTACIONES ---
// Importamos los SDKs (Software Development Kits) de Google Cloud que instalamos.
const admin = require('firebase-admin');
const { VertexAI } = require('@google-cloud/vertexai'); // <-- Para los modelos generativos
const { MatchServiceClient } = require('@google-cloud/aiplatform'); // <-- Para Vector Search
const { Storage } = require('@google-cloud/storage');

// --- SECCIÓN 2: INICIALIZACIÓN DE SERVICIOS ---
// Este es el núcleo de la configuración.
// Cuando este código se ejecute en el entorno de Google Cloud Run, estas librerías
// detectarán automáticamente las credenciales de la Cuenta de Servicio que creamos.
// Por eso no es necesario pasar ninguna API Key.

// Inicializar el SDK de Firebase Admin, que nos da acceso a Firestore.
admin.initializeApp();
const db = admin.firestore();

// Inicializar el cliente de Vertex AI, especificando el proyecto y la ubicación
// que leerá de las variables de entorno.
const vertex_ai = new VertexAI({
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION
});

// Obtener los modelos de IA específicos que usaremos.
// Usamos los nombres oficiales y estables para producción.
const generativeModel = vertex_ai.getGenerativeModel({ model: "gemini-2.5-pro" });
const visionGenerativeModel = vertex_ai.getGenerativeModel({ model: "gemini-2.5-pro" });
const embeddingModel = vertex_ai.getGenerativeModel({ model: "embedding-001" });

// Inicializar el cliente específico para hacer búsquedas en Vertex AI Vector Search.
const matchServiceClient = new MatchServiceClient();

// Inicializar el cliente para interactuar con Google Cloud Storage.
const storage = new Storage();
// Apuntar a nuestro bucket específico, cuyo nombre leerá de las variables de entorno.
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);


// --- SECCIÓN 3: EXPORTACIONES ---
// Hacemos que todos los servicios inicializados estén disponibles para cualquier
// otro archivo de nuestra aplicación que los necesite (como los controladores).
module.exports = {
    db,                     // Para interactuar con Firestore
    generativeModel,        // Para generar texto
    visionGenerativeModel,  // Para analizar imágenes
    embeddingModel,         // Para crear embeddings de texto
    matchServiceClient,     // Para buscar vectores
    bucket,                 // Para subir y gestionar archivos
    admin                   // Exportamos 'admin' por si necesitamos funciones especiales como FieldValue
};