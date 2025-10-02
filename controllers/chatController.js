// En: backend/controllers/chatController.js
// --- SECCIÓN 1: IMPORTACIONES ---
const { db, admin, generativeModel, bucket } = require('../config/db');
const { extractTextFromFile, getEmbedding, chunkDocument, findRelevantChunksAcrossDocuments, upsertToPinecone } = require('../utils/documentProcessor');


// --- SECCIÓN 2: LÓGICA DE RUTAS (CRUD BÁSICO) ---

/**
 * @desc    Obtener todos los chats de un usuario (VERSIÓN CORREGIDA CON DEBUGGING)
 * @route   GET /api/chats
 */
const getChats = async (req, res) => {
    console.log("-> Entrando a la ruta GET /api/chats");
    try {
        const chatsSnapshot = await db.collection('chats')
            .where('userId', '==', req.user._id)
            .orderBy('updatedAt', 'desc')
            .get();
        
        console.log(`Se encontraron ${chatsSnapshot.docs.length} chats para el usuario ${req.user._id}.`);

        const chats = chatsSnapshot.docs.map(doc => {
            const data = doc.data();
            // Comprobación de seguridad: nos aseguramos de que 'updatedAt' exista antes de convertirlo.
            const updatedAtDate = data.updatedAt ? data.updatedAt.toDate() : new Date();

            return { 
                _id: doc.id, // Usamos _id para mantener la compatibilidad con el frontend
                title: data.title,
                updatedAt: updatedAtDate
            };
        });

        console.log("Enviando la siguiente lista de chats al frontend:", chats);
        res.json(chats);

    } catch (error) { 
        console.error("ERROR CRÍTICO en getChats:", error);
        res.status(500).json({ message: 'Error del servidor al obtener chats' }); 
    }
};

/**
 * @desc    Crear un nuevo chat
 * @route   POST /api/chats
 */
const createChat = async (req, res) => {
    console.log("-> Entrando a la ruta POST /api/chats");
    try {
        const newChatData = {
            title: 'Nuevo Chat',
            messages: [],
            documents: [],
            userId: req.user._id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            activeContext: 'miscellaneous' 
        };

        const newChatRef = await db.collection('chats').add(newChatData);
        const savedChatDoc = await newChatRef.get();
        const savedChatData = savedChatDoc.data();
        
        console.log(`Nuevo chat creado con ID: ${newChatRef.id} y activeContext: 'miscellaneous'`);
              res.status(201).json({ 
            _id: savedChatDoc.id, 
            ...savedChatData,
            createdAt: savedChatData.createdAt.toDate(),
            updatedAt: savedChatData.updatedAt.toDate()
        });
    } catch (error) { 
        console.error("Error al crear chat:", error);
        res.status(500).json({ message: 'Error del servidor al crear chat' }); 
    }
};
const getChatById = async (req, res) => {
    try {
        const chatDoc = await db.collection('chats').doc(req.params.id).get();
        if (!chatDoc.exists || chatDoc.data().userId !== req.user._id) {
            return res.status(404).json({ message: 'Chat no encontrado o no autorizado' });
        }
        res.json({ _id: chatDoc.id, ...chatDoc.data() });
    } catch (error) {
        console.error("Error al obtener chat por ID:", error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

const deleteChat = async (req, res) => {
    try {
        const chatRef = db.collection('chats').doc(req.params.id);
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists || chatDoc.data().userId !== req.user._id) {
            return res.status(404).json({ message: 'Chat no encontrado o no autorizado' });
        }
        await chatRef.delete();
        res.json({ message: 'Chat eliminado exitosamente' });
    } catch (error) {
        console.error("Error al eliminar chat:", error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// En: backend/controllers/chatController.js

const updateChatTitle = async (req, res) => {
    const { newTitle } = req.body;
    if (!newTitle || typeof newTitle !== 'string' || newTitle.trim().length === 0) {
        return res.status(400).json({ message: 'Se requiere un nuevo título válido.' });
    }
    try {
        const chatRef = db.collection('chats').doc(req.params.id);
        const chatDoc = await chatRef.get();

        if (!chatDoc.exists || chatDoc.data().userId !== req.user._id) {
            return res.status(404).json({ message: 'Chat no encontrado o no autorizado' });
        }

        // Actualizamos el documento en la base de datos
        await chatRef.update({ 
            title: newTitle.trim(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // --- LA CORRECCIÓN ---
        // Volvemos a obtener el documento ya actualizado para enviarlo de vuelta
        const updatedChatDoc = await chatRef.get();
        
        // Enviamos el objeto de chat completo, que es lo que el frontend espera
        res.json({ 
            _id: updatedChatDoc.id, 
            ...updatedChatDoc.data() 
        });

    } catch (error) {
        console.error("Error al actualizar título:", error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// --- SECCIÓN 3: LÓGICA DE RUTAS (ACCIONES COMPLEJAS) ---

const processDocuments = async (req, res) => {
    const { chatId, documentType } = req.body;
    if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No se enviaron archivos.' });

    // Validación para asegurarse de que documentType es una clave válida.
    if (!documentType || typeof documentType !== 'string') {
        return res.status(400).json({ message: 'El tipo de documento (contexto) es inválido.' });
    }

    try {
        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) return res.status(404).json({ message: "Chat no encontrado." });
        const isSuperuserMode = chatDoc.data().isSuperuserMode;

        for (const file of req.files) {
            // ... (Lógica de subir a GCS, extraer texto, chunking, generar embeddings y subir a Pinecone se mantiene igual)
            const gcsFileName = `${req.user._id}/${chatId}/${Date.now()}-${file.originalname}`;
            const blob = bucket.file(gcsFileName);
            await blob.save(file.buffer);
            const text = await extractTextFromFile(file.buffer, file.mimetype, file.originalname);
            const chunks = chunkDocument(text);
            const documentId = `doc_${chatId}_${Date.now()}`;
            
            const vectorsToUpsert = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embedding = await getEmbedding(chunk);
                vectorsToUpsert.push({
                    id: `${documentId}_chunk_${i}`,
                    values: embedding,
                    metadata: { documentId, chunkText: chunk }
                });
            }
            if (vectorsToUpsert.length > 0) {
                await upsertToPinecone(vectorsToUpsert);
            }
            
            // --- ¡LA CORRECCIÓN FINAL Y MÁS IMPORTANTE ESTÁ AQUÍ! ---
            const newDocumentData = { documentId, originalName: file.originalname, gcsPath: gcsFileName, chunkCount: chunks.length, createdAt: new Date() };
            const systemMessage = { sender: 'bot', text: `Archivo "${file.originalname}" procesado y añadido al contexto '${documentType}'.`, timestamp: new Date() };

            if (isSuperuserMode) {
                await db.collection('globalDocuments').add({ ...newDocumentData, uploadedBy: req.user._id });
                await chatRef.update({ messages: admin.firestore.FieldValue.arrayUnion(systemMessage) });
            } else {
                // Usamos el 'documentType' dinámico que viene del frontend para guardar en el campo correcto.
                // Ejemplo: Si documentType es 'miscellaneous', guardará en el array 'miscellaneous'.
                await chatRef.update({
                    [documentType]: admin.firestore.FieldValue.arrayUnion(newDocumentData),
                    messages: admin.firestore.FieldValue.arrayUnion(systemMessage),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        
        // ... (El resto de la función para formatear y enviar la respuesta se mantiene igual)
        const finalChatStateDoc = await chatRef.get();
        const finalChatData = finalChatStateDoc.data();
        // ... (formateo de timestamps)
        res.status(200).json({ updatedChat: { _id: finalChatStateDoc.id, ...finalChatData } });

    } catch (error) {
        console.error('[processDocuments] Error:', error);
        res.status(500).json({ message: 'Error al procesar los archivos.', details: error.message });
    }
};


// --- FUNCIÓN AUXILIAR PARA RAG (RESTAURADA A TU LÓGICA ORIGINAL) ---
function getDocumentsForActiveContext(chat) {
    const contextKey = chat.activeContext;
    // Esta lógica ahora funcionará porque processDocuments guarda en el campo correcto.
    if (chat[contextKey] && Array.isArray(chat[contextKey])) {
        return chat[contextKey].map(doc => doc.documentId);
    }
    return [];
}


// --- FUNCIÓN AUXILIAR PARA RAG ---
// (Esta función la usará handleChatMessage)
function getDocumentsForActiveContext(chat) {
    const contextKey = chat.activeContext;
    if (chat[contextKey] && Array.isArray(chat[contextKey])) {
        return chat[contextKey].map(doc => doc.documentId);
    }
    return [];
}


// En: backend/controllers/chatController.js

const handleChatMessage = async (req, res) => {
    const { conversationHistory, chatId } = req.body;
    if (!chatId || !Array.isArray(conversationHistory)) {
        return res.status(400).json({ message: 'Datos de entrada inválidos.' });
    }

    try {
        console.log("--- handleChatMessage: INICIO ---");
        const userQuery = conversationHistory[conversationHistory.length - 1].parts[0].text;
        
        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) { return res.status(404).json({ message: "Chat no encontrado." }); }
        const currentChat = chatDoc.data();

        // ...// --- LÓGICA DE COMANDOS ESPECIALES ---
        if (userQuery === process.env.SUPERUSER_SECRET && !currentChat.isSuperuserMode) {
            await chatRef.update({ 
                isSuperuserMode: true,
                messages: admin.firestore.FieldValue.arrayUnion({ sender: 'bot', text: 'Modo Superusuario ACTIVADO.' })
            });
            const updatedChatDoc = await chatRef.get();
            return res.status(200).json({ updatedChat: { _id: updatedChatDoc.id, ...updatedChatDoc.data() } });
        }
        if (userQuery === "exit" && currentChat.isSuperuserMode) {
            await chatRef.update({ 
                isSuperuserMode: false,
                messages: admin.firestore.FieldValue.arrayUnion({ sender: 'bot', text: 'Modo Superusuario DESACTIVADO.' })
            });
            const updatedChatDoc = await chatRef.get();
            return res.status(200).json({ updatedChat: { _id: updatedChatDoc.id, ...updatedChatDoc.data() } });
        }


        console.log("--- handleChatMessage: INICIANDO LÓGICA RAG ---");

        const documentIdsInChat = getDocumentsForActiveContext(currentChat);
        const globalDocsSnapshot = await db.collection('globalDocuments').get();
        const globalDocumentIds = globalDocsSnapshot.docs.map(doc => doc.data().documentId);
        const allSearchableIds = [...new Set([...documentIdsInChat, ...globalDocumentIds])];
        
        let contents = conversationHistory;

        if (allSearchableIds.length > 0) {
            console.log(`Buscando en ${allSearchableIds.length} IDs de documentos.`);

            // --- PUESTO DE CONTROL 1: EMBEDDING ---
            console.log("Paso 1: Intentando crear embedding...");
            const queryEmbedding = await getEmbedding(userQuery);
            console.log("Paso 1: Embedding creado con éxito.");
            
            // --- PUESTO DE CONTROL 2: BÚSQUEDA DE VECTORES ---
            console.log("Paso 2: Intentando buscar chunks relevantes...");
            const relevantChunks = await findRelevantChunksAcrossDocuments(queryEmbedding, allSearchableIds);
            console.log(`Paso 2: Búsqueda de chunks finalizada. Encontrados: ${relevantChunks.length}`);

            if (relevantChunks.length > 0) {
                const contextString = `--- CONTEXTO ---\n${relevantChunks.join("\n---\n")}\n--- FIN DEL CONTEXTO ---\n\nPregunta: ${userQuery}`;
                contents[contents.length - 1].parts[0].text = contextString;
            }
        }

        // --- PUESTO DE CONTROL 3: LLAMADA A LA IA ---
        console.log("Paso 3: Intentando enviar mensaje a Gemini...");
        const chatSession = generativeModel.startChat({ history: contents.slice(0, -1) });
        const result = await chatSession.sendMessage(contents[contents.length - 1].parts);
        console.log("Paso 3: Respuesta recibida de Gemini.");

        let botText = "No pude generar una respuesta.";
        if (result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            botText = result.response.candidates[0].content.parts[0].text;
        }

        const userMessage = { sender: 'user', text: userQuery, timestamp: new Date() };
        const botMessage = { sender: 'ai', text: botText, timestamp: new Date() };

        // --- PUESTO DE CONTROL 4: ACTUALIZACIÓN DE FIRESTORE ---
        console.log("Paso 4: Intentando actualizar Firestore...");
        await chatRef.update({
            messages: admin.firestore.FieldValue.arrayUnion(userMessage, botMessage),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("Paso 4: Firestore actualizado con éxito.");

        const updatedChatDoc = await chatRef.get();
        // ... (lógica de formateo de respuesta)
        res.status(200).json({ updatedChat: { _id: updatedChatDoc.id, ...updatedChatDoc.data() } });

    } catch (error) {
        // --- LOG DE ERROR DEFINITIVO ---
        console.error("[handleChatMessage] ERROR CRÍTICO CAPTURADO:", error);
        res.status(500).json({ message: "Error inesperado en el servidor al procesar el mensaje." });
    }
};

        
      


const extractJson = async (req, res) => {
    console.log("-> Entrando a la ruta POST /api/chats/extract-json");
    // Aquí iría la lógica completa de extracción de JSON...
    res.status(200).json({ message: "La función extractJson fue llamada correctamente. Lógica pendiente de implementación completa." });
};

const generateReport = async (req, res) => {
    console.log("-> Entrando a la ruta POST /api/chats/generate-report");
    // Aquí iría la lógica completa de generación de informes...
    res.status(200).json({ message: "La función generateReport fue llamada correctamente. Lógica pendiente de implementación completa." });
};
// --- SECCIÓN 4: EXPORTACIONES ---
module.exports = {
    getChats,
    createChat,
    getChatById,
    deleteChat,
    updateChatTitle,
    processDocuments,
    handleChatMessage,
    extractJson,
    generateReport 
};