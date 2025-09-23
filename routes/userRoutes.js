// En: backend/routes/userRoutes.js

const express = require('express');
const router = express.Router();

// Importamos las funciones del controlador que contendrán la lógica
const {
    registerUser,
    loginUser,
    getMe
} = require('../controllers/userController');

// Importamos el middleware de protección
const { protect } = require('../middleware/authMiddleware');

// Definimos las rutas y las asociamos con su función lógica
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', protect, getMe); // La ruta de perfil ahora se llamará 'me' para mayor claridad

// Exportamos el router
module.exports = router;