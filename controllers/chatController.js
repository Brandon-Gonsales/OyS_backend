// En: backend/controllers/chatController.js

// --- SECCIÓN 1: IMPORTACIONES ---
const { db, admin, generativeModel, bucket } = require('../config/db');
const { extractTextFromFile, getEmbedding, chunkDocument, findRelevantChunksAcrossDocuments } = require('../utils/documentProcessor');


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
            userId: req.user._id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const newChatRef = await db.collection('chats').add(newChatData);

        console.log(`Nuevo chat creado con ID: ${newChatRef.id}`);
        res.status(201).json({ 
            _id: newChatRef.id, 
            ...newChatData 
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

    try {
        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) return res.status(404).json({ message: "Chat no encontrado." });
        const isSuperuserMode = chatDoc.data().isSuperuserMode;

        for (const file of req.files) {
            const gcsFileName = `${req.user._id}/${chatId}/${Date.now()}-${file.originalname}`;
            const blob = bucket.file(gcsFileName);
            await blob.save(file.buffer);

            const text = await extractTextFromFile(file.buffer, file.mimetype, file.originalname);
            const chunks = chunkDocument(text);
            const documentId = `doc_${chatId}_${Date.now()}`;
            
            const newDocumentData = { documentId, originalName: file.originalname, gcsPath: gcsFileName, chunkCount: chunks.length, createdAt: admin.firestore.FieldValue.serverTimestamp() };
            const systemMessage = { sender: 'bot', text: `Archivo "${file.originalname}" procesado y añadido a '${documentType}'.` };

            if (isSuperuserMode) {
                await db.collection('globalDocuments').add({ ...newDocumentData, uploadedBy: req.user._id });
                await chatRef.update({ messages: admin.firestore.FieldValue.arrayUnion(systemMessage) });
            } else {
                await chatRef.update({
                    [documentType]: admin.firestore.FieldValue.arrayUnion(newDocumentData),
                    messages: admin.firestore.FieldValue.arrayUnion(systemMessage),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        
        const finalChatStateDoc = await chatRef.get();
        res.status(200).json({ updatedChat: { _id: finalChatStateDoc.id, ...finalChatStateDoc.data() } });

    } catch (error) {
        console.error('[processDocuments] Error:', error);
        res.status(500).json({ message: 'Error al procesar los archivos.', details: error.message });
    }
};

// --- FUNCIÓN AUXILIAR PARA RAG ---
// (Esta función la usará handleChatMessage)
function getDocumentsForActiveContext(chat) {
    const contextKey = chat.activeContext;
    if (chat[contextKey] && Array.isArray(chat[contextKey])) {
        return chat[contextKey].map(doc => doc.documentId);
    }
    return [];
}


// --- LÓGICA PRINCIPAL DEL CHAT ---
const handleChatMessage = async (req, res) => {
    const { conversationHistory, chatId } = req.body;
    if (!chatId || !Array.isArray(conversationHistory)) {
        return res.status(400).json({ message: 'Datos de entrada inválidos.' });
    }

    try {
        const userQuery = conversationHistory[conversationHistory.length - 1].parts[0].text;
        
        const chatRef = db.collection('chats').doc(chatId);
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) {
            return res.status(404).json({ message: "Chat no encontrado." });
        }
        const currentChat = chatDoc.data();

        // --- LÓGICA DE COMANDOS ESPECIALES ---
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

        // --- LÓGICA RAG ---
        console.log("Iniciando lógica RAG...");

        // 1. Obtener los IDs de los documentos relevantes (se mantiene igual)
        const documentIdsInChat = getDocumentsForActiveContext(currentChat);
        const globalDocsSnapshot = await db.collection('globalDocuments').get();
        const globalDocumentIds = globalDocsSnapshot.docs.map(doc => doc.data().documentId);
        const allSearchableIds = [...new Set([...documentIdsInChat, ...globalDocumentIds])];
        
        // --- LA CORRECCIÓN PRINCIPAL ---
        // El frontend ya envía el historial en el formato correcto {role, parts}.
        // Simplemente asignamos el historial directamente, sin volver a mapearlo.
        let contents = conversationHistory;

        if (allSearchableIds.length > 0) {
            console.log(`Buscando en ${allSearchableIds.length} IDs de documentos únicos.`);
            
            // 2. Crear embedding y buscar chunks (se mantiene igual)
            const queryEmbedding = await getEmbedding(userQuery);
            const relevantChunks = await findRelevantChunksAcrossDocuments(queryEmbedding, allSearchableIds);
            
            // 3. Aumentar el contexto
            if (relevantChunks.length > 0) {
                console.log(`Se encontraron ${relevantChunks.length} chunks relevantes.`);
                const contextString = `--- INICIO DEL CONTEXTO ---\n${relevantChunks.join("\n---\n")}\n--- FIN DEL CONTEXTO ---\n\nBasándote **únicamente** en el contexto proporcionado, responde a la siguiente pregunta. Si la respuesta no está en el contexto, di que no tienes suficiente información. Pregunta: ${userQuery}`;
                
                // Actualizamos el texto de la última parte del historial (la pregunta del usuario)
                contents[contents.length - 1].parts[0].text = contextString;
            } else {
                console.log("No se encontraron chunks relevantes para la consulta.");
            }
        }

        // 4. Generar la respuesta con el modelo de IA
        const chatSession = generativeModel.startChat({ 
            history: contents.slice(0, -1)
        });

        // Enviamos la última parte del contenido, que puede haber sido modificada con el contexto
        const result = await chatSession.sendMessage(contents[contents.length - 1].parts);
        const botText = result.response.text();

        // 5. Guardar el historial en Firestore y responder (se mantiene igual)
        await chatRef.update({
            messages: admin.firestore.FieldValue.arrayUnion(
                { sender: 'user', text: userQuery, timestamp: admin.firestore.FieldValue.serverTimestamp() },
                { sender: 'ai', text: botText, timestamp: admin.firestore.FieldValue.serverTimestamp() }
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const updatedChatDoc = await chatRef.get();
        res.status(200).json({ updatedChat: { _id: updatedChatDoc.id, ...updatedChatDoc.data() } });

    } catch (error) {
        console.error("[handleChatMessage] Error:", error);
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