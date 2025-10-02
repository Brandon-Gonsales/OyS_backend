// En: backend/utils/documentProcessor.js
const path = require('path');
const mammoth = require("mammoth");
const xlsx = require('xlsx');
const pdf = require('pdf-parse');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');  

// Importamos los servicios de IA desde nuestra configuración central
const { visionGenerativeModel, pineconeIndex } = require('../config/db');

// --- FUNCIONES DE PROCESAMIENTO DE TEXTO Y ARCHIVOS ---

/**
 * @desc Extrae texto de varios tipos de archivos a partir de un buffer en memoria.
 * @param {Buffer} fileBuffer - El contenido del archivo.
 * @param {string} clientMimeType - El tipo MIME del archivo.
 * @param {string} originalName - El nombre original del archivo.
 * @returns {Promise<string>} El texto extraído.
 */
const extractTextFromFile = async (fileBuffer, clientMimeType, originalName) => {
    const fileExt = path.extname(originalName).toLowerCase();
    let text = '';

    // CASO 1: DOCX (mammoth)
    if (fileExt === '.docx') {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        text = result.value;
    }
    // CASO 2: XLSX (xlsx)
    else if (fileExt === '.xlsx' || fileExt === '.xls') {
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const fullText = [];
        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const sheetText = xlsx.utils.sheet_to_txt(worksheet);
            if (sheetText) fullText.push(`Contenido de la hoja "${sheetName}":\n${sheetText}`);
        });
        text = fullText.join('\n\n---\n\n');
    }
    // CASO 3: PDF (pdf-parse con fallback a Gemini)
    else if (fileExt === '.pdf') {
        try {
            const data = await pdf(fileBuffer);
            text = data.text;
            if (!text || !text.trim()) throw new Error("pdf-parse no extrajo texto.");
        } catch (error) {
            console.warn("pdf-parse falló. Usando fallback de Gemini...");
            text = await extractTextWithGemini(fileBuffer, clientMimeType);
        }
    }
    // CASO 4: IMÁGENES
    else if (['.jpg', '.jpeg', '.png', '.webp'].includes(fileExt) || clientMimeType.startsWith('image/')) {
        text = await describeImageWithGemini(fileBuffer, clientMimeType, originalName);
    }
    // CASO 5: TXT
    else if (fileExt === '.txt' || clientMimeType === 'text/plain') {
        text = fileBuffer.toString('utf-8');
    }
    // CASO 6: Archivo no soportado (se podría añadir el microservicio aquí si es necesario)
    else {
        throw new Error(`Tipo de archivo no soportado: ${fileExt} (${clientMimeType})`);
    }

    if (!text || !text.trim()) {
        throw new Error('No se pudo extraer o generar contenido de texto del archivo.');
    }
    return text;
};

// --- FUNCIONES DE IA Y VECTORES ---

/**
 * @desc Crea un embedding para un fragmento de texto usando Vertex AI.
 * @param {string} text - El texto a convertir en embedding.
 * @returns {Promise<number[]>} El vector de embedding.
 */


const getEmbedding = async (text) => {
    try {
        // --- LA SOLUCIÓN DEFINITIVA USANDO HTTP DIRECTO ---

        // 1. Obtenemos las credenciales y el token de acceso automáticamente.
        //    Esto funciona tanto en local (con la variable de entorno) como en Cloud Run.
        const auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform'
        });
        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        // 2. Definimos el endpoint y el cuerpo de la petición, tal como en la documentación.
        const projectId = process.env.GOOGLE_CLOUD_PROJECT;
        const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;
        
        const data = {
            instances: [
                { content: text }
            ]
        };

        // 3. Hacemos la llamada a la API con Axios, incluyendo el token de autorización.
        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        // 4. Extraemos el embedding de la respuesta.
        return response.data.predictions[0].embeddings.values;

    } catch (error) {
        // Mejoramos el log de error para ver la respuesta de la API si falla.
        console.error("Error al generar embedding:", error.response ? error.response.data : error.message);
        throw new Error("No se pudo generar el embedding.");
    }
};

/**
 * @desc Divide un texto largo en fragmentos más pequeños (chunks).
 * @param {string} text - El texto completo.
 * @returns {string[]} Un array de chunks de texto.
 */
const chunkDocument = (text, chunkSize = 1000, overlap = 200) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
};

// --- (NUEVAS FUNCIONES PARA PINECONE) ---

/**
 * @desc (NUEVO) Sube los vectores a Pinecone.
 * @param {Array<object>} vectors - Un array de objetos vectoriales para Pinecone.
 */
const upsertToPinecone = async (vectors) => {
    if (!vectors || vectors.length === 0) return;
    try {
        console.log(`[Pinecone] Subiendo ${vectors.length} vectores...`);
        // Usamos el pineconeIndex que importamos desde nuestra configuración.
        await pineconeIndex.upsert(vectors);
        console.log("[Pinecone] Subida completada con éxito.");
    } catch (error) {
        console.error("[Pinecone] Error al subir los vectores:", error);
        throw new Error("No se pudieron guardar los embeddings en Pinecone.");
    }
};

/**
 * @desc (CORREGIDO) Busca los chunks de documentos más relevantes en Pinecone.
 */
const findRelevantChunksAcrossDocuments = async (queryEmbedding, documentIds, topK = 5) => {
    if (!documentIds || documentIds.length === 0) return [];
    try {
        console.log(`[Pinecone] Buscando en los documentos: ${documentIds.join(', ')}`);
        const queryResponse = await pineconeIndex.query({
            topK,
            vector: queryEmbedding,
            filter: { documentId: { "$in": documentIds } },
            includeMetadata: true,
        });

        if (queryResponse.matches?.length) {
            // Pinecone devuelve los metadatos, así que podemos extraer el texto directamente.
            return queryResponse.matches.map(match => match.metadata.chunkText);
        }
        return [];
    } catch (error) {
        console.error("[Pinecone] Error al realizar la búsqueda:", error);
        return [];
    }
};

// --- FUNCIONES AUXILIARES DE GEMINI ---

async function extractTextWithGemini(fileBuffer, mimetype) {
    const filePart = { inlineData: { data: fileBuffer.toString("base64"), mimeType: mimetype } };
    const prompt = "Extrae todo el texto de este documento. Devuelve únicamente el texto plano, sin ningún formato adicional, como si lo copiaras y pegaras. No resumas nada.";
    const result = await visionGenerativeModel.generateContent([prompt, filePart]);
    return result.response.text();
}

async function describeImageWithGemini(fileBuffer, mimetype, originalName) {
    const filePart = { inlineData: { data: fileBuffer.toString("base64"), mimeType: mimetype } };
    const prompt = "Describe detalladamente esta imagen...";
    const result = await visionGenerativeModel.generateContent([prompt, filePart]);
    return `Descripción de la imagen "${originalName}":\n${result.response.text()}`;
}


// --- SECCIÓN 5: EXPORTACIONES ---
module.exports = {
    extractTextFromFile,
    getEmbedding,
    chunkDocument,
    findRelevantChunksAcrossDocuments, // Ahora usa Pinecone
    upsertToPinecone // La nueva función de subida para Pinecone
};