// En: backend/controllers/chatController.js

// --- SECCIÓN 1: IMPORTACIONES ---
const { db, admin, generativeModel, bucket } = require('../config/db');
const { extractTextFromFile, getEmbedding, chunkDocument, findRelevantChunksAcrossDocuments } = require('../utils/documentProcessor');


// --- SECCIÓN 2: LÓGICA DE RUTAS (CRUD BÁSICO) ---

const getChats = async (req, res) => {
    // ... (código que ya tienes)
};

const createChat = async (req, res) => {
    // ... (código que ya tienes)
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
        await chatRef.update({ 
            title: newTitle.trim(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ message: 'Título actualizado' });
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
            // 1. Subir el archivo original a Cloud Storage
            const gcsFileName = `${req.user._id}/${chatId}/${Date.now()}-${file.originalname}`;
            const blob = bucket.file(gcsFileName);
            await blob.save(file.buffer);

            // 2. Procesar el archivo
            const text = await extractTextFromFile(file.buffer, file.mimetype, file.originalname);
            const chunks = chunkDocument(text);
            const documentId = `doc_${chatId}_${Date.now()}`;

            // 3. (Futuro) Generar embeddings y subirlos a Vector Search. Por ahora, solo guardamos la metadata.
            
            // 4. Actualizar Firestore
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

const handleChatMessage = async (req, res) => {
    const { conversationHistory, chatId } = req.body;
    const userQuery = conversationHistory[conversationHistory.length - 1].parts[0].text;

    try {
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) return res.status(404).json({ message: "Chat no encontrado." });
        
        const currentChat = chatDoc.data();
        
        // Aquí iría tu lógica de superusuario, RAG, etc. adaptada a Firestore...
        // ... por simplicidad, implementamos un eco básico por ahora
        
        const botText = `Recibí tu mensaje: "${userQuery}". La lógica RAG completa debe ser implementada aquí.`;

        // Actualizar el chat en Firestore
        const chatRef = db.collection('chats').doc(chatId);
        await chatRef.update({
            messages: admin.firestore.FieldValue.arrayUnion(
                { sender: 'user', text: userQuery },
                { sender: 'ai', text: botText }
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const updatedChatDoc = await chatRef.get();
        res.status(200).json({ updatedChat: { _id: updatedChatDoc.id, ...updatedChatDoc.data() } });

    } catch (error) {
        console.error("[handleChatMessage] Error:", error);
        res.status(500).json({ message: "Error inesperado en el servidor." });
    }
};


// --- SECCIÓN 4: EXPORTACIONES ---
module.exports = {
    getChats,
    createChat,
    getChatById,
    deleteChat,
    updateChatTitle,
    processDocuments,
    handleChatMessage
    // Aún faltan extractJson y generateReport, que son más complejas
};