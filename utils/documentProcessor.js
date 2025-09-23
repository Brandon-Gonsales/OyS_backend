// En: backend/utils/documentProcessor.js

const path = require('path');
const mammoth = require("mammoth");
const xlsx = require('xlsx');
const pdf = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');

// Importamos los servicios de IA desde nuestra configuración central
const {
    visionGenerativeModel,
    embeddingModel,
    matchServiceClient
} = require('../config/db');

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
        const result = await embeddingModel.embedContent({
            contents: [{ role: 'user', parts: [{ text: text }] }]
        });
        return result.predictions[0].embeddings.values;
    } catch (error) {
        console.error("Error al generar embedding:", error);
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

/**
 * @desc Busca los chunks de documentos más relevantes en Vertex AI Vector Search.
 * @param {number[]} queryEmbedding - El embedding de la pregunta del usuario.
 * @param {string[]} documentIds - Los IDs de los documentos en los que buscar.
 * @returns {Promise<string[]>} Un array con el texto de los chunks relevantes.
 */
const findRelevantChunksAcrossDocuments = async (queryEmbedding, documentIds, topK = 5) => {
    if (!documentIds || documentIds.length === 0) return [];

    const indexEndpoint = process.env.VERTEX_AI_INDEX_ENDPOINT;
    const deployedIndexId = process.env.VERTEX_AI_DEPLOYED_INDEX_ID;

    const request = {
        indexEndpoint: indexEndpoint,
        deployedIndexId: deployedIndexId,
        queries: [{
            vector: queryEmbedding,
            topNeighborCount: topK,
            stringFilter: [{ name: 'documentId', allowList: documentIds }]
        }]
    };

    try {
        const [response] = await matchServiceClient.findNeighbors(request);
        const neighbors = response.nearestNeighbors?.[0]?.neighbors;
        if (!neighbors || neighbors.length === 0) return [];
        
        // Esta parte es CRÍTICA: Vector Search no devuelve metadatos como Pinecone.
        // La mejor práctica es recuperar los IDs de los chunks y luego buscar su contenido en Firestore.
        // Asumiremos que tenemos una colección 'documentChunks' para este propósito.
        const chunkIds = neighbors.map(n => n.datapoint.datapointId);
        // (Aquí iría la lógica para buscar estos IDs en una colección de Firestore)
        // Por ahora, devolvemos un texto de marcador de posición.
        return chunkIds.map(id => `Texto del chunk con ID: ${id}`); // <<-- NECESITA AJUSTE CON LA BD
    } catch (error) {
        console.error("[Vertex AI] Error al realizar la búsqueda de vectores:", error);
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


// --- EXPORTACIONES ---
module.exports = {
    extractTextFromFile,
    getEmbedding,
    chunkDocument,
    findRelevantChunksAcrossDocuments
};