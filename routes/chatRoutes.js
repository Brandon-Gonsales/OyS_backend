// En: backend/routes/chatRoutes.js

// --- SECCIÓN 1: IMPORTACIONES ---
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');

// --- SECCIÓN 2: IMPORTAR LAS FUNCIONES DEL CONTROLADOR ---
// NOTA IMPORTANTE: Estamos importando funciones de un archivo que AÚN NO HEMOS CREADO.
// Esto es normal en este proceso de refactorización. En el siguiente paso, crearemos
// el archivo 'chatController.js' y todas estas funciones.
const {
    getChats,
    createChat,
    getChatById,
    deleteChat,
    updateChatTitle,
    processDocuments,
    handleChatMessage,
    //extractJson,
    //generateReport
} = require('../controllers/chatController');


// --- SECCIÓN 3: CONFIGURACIÓN DE MIDDLEWARE ESPECÍFICO ---
// Configuramos multer para que maneje la subida de archivos en memoria.
// Lo definimos aquí porque solo las rutas de este archivo lo necesitan.
const upload = multer({ storage: multer.memoryStorage() }).array('files', 10);
const singleUpload = multer({ storage: multer.memoryStorage() }).single('file');


// --- SECCIÓN 4: DEFINICIÓN DE LAS RUTAS ---
// Organizamos las rutas para que sean limpias y lógicas.

// Rutas para la colección de chats (/api/chats)
router.route('/')
    .get(protect, getChats)       // GET /api/chats -> Obtener todos los chats del usuario
    .post(protect, createChat);   // POST /api/chats -> Crear un nuevo chat

// Rutas para un chat específico (/api/chats/:id)
router.route('/:id')
    .get(protect, getChatById)    // GET /api/chats/:id -> Obtener un chat por su ID
    .delete(protect, deleteChat); // DELETE /api/chats/:id -> Eliminar un chat

// Ruta para actualizar el título de un chat
router.put('/:id/title', protect, updateChatTitle); // PUT /api/chats/:id/title -> Actualizar título

// Rutas de acciones específicas
router.post('/process-document', protect, upload, processDocuments);  // Subir y procesar documentos para un chat
router.post('/message', protect, handleChatMessage);                 // Enviar un nuevo mensaje a un chat
//router.post('/extract-json', protect, singleUpload, extractJson);      // Extraer JSON de un documento
//router.post('/generate-report', protect, generateReport);            // Generar un informe para un chat

// --- SECCIÓN 5: EXPORTACIÓN ---
// Exportamos el router para que nuestro server.js principal pueda usarlo.
module.exports = router;