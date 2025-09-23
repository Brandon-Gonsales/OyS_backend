// En: backend/controllers/userController.js

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('../config/db'); // Importamos nuestra base de datos Firestore

// --- FUNCIÓN DE UTILIDAD ---
// Generar un JSON Web Token (JWT)
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

// --- LÓGICA DE LAS RUTAS ---

/**
 * @desc    Registrar un nuevo usuario
 * @route   POST /api/users/register
 */
const registerUser = async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Por favor, complete todos los campos.' });
    }

    try {
        // 1. Verificar si el usuario ya existe en Firestore
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();
        if (!snapshot.empty) {
            return res.status(400).json({ message: 'El usuario ya existe.' });
        }

        // 2. Hashear la contraseña (usamos bcryptjs directamente, ya que no tenemos el método del modelo)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Crear el nuevo usuario en Firestore
        const newUserRef = await usersRef.add({
            name,
            email,
            password: hashedPassword,
        });
        
        const newUserDoc = await newUserRef.get();

        // 4. Enviar respuesta con el token
        res.status(201).json({
            _id: newUserDoc.id,
            name: newUserDoc.data().name,
            email: newUserDoc.data().email,
            token: generateToken(newUserDoc.id),
        });
    } catch (error) {
        console.error("Error al registrar usuario:", error);
        res.status(500).json({ message: 'Error del servidor.', error: error.message });
    }
};

/**
 * @desc    Autenticar (iniciar sesión) un usuario
 * @route   POST /api/users/login
 */
const loginUser = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Por favor, proporcione email y contraseña.' });
    }
    
    try {
        // 1. Buscar al usuario por email en Firestore
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();
        if (snapshot.empty) {
            return res.status(401).json({ message: 'Email o contraseña inválidos.' });
        }
        
        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        // 2. Comparar la contraseña (reemplaza a user.matchPassword(password))
        if (await bcrypt.compare(password, userData.password)) {
            // 3. Si la contraseña es correcta, enviar respuesta con el token
            res.json({
                _id: userDoc.id,
                name: userData.name,
                email: userData.email,
                token: generateToken(userDoc.id),
            });
        } else {
            res.status(401).json({ message: 'Email o contraseña inválidos.' });
        }
    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        res.status(500).json({ message: 'Error del servidor.', error: error.message });
    }
};

/**
 * @desc    Obtener los datos del usuario autenticado
 * @route   GET /api/users/me
 */
const getMe = async (req, res) => {
    // El middleware 'protect' ya ha buscado al usuario en Firestore
    // y ha adjuntado sus datos a req.user. Simplemente lo devolvemos.
    res.status(200).json(req.user);
};

// --- EXPORTACIONES ---
module.exports = {
    registerUser,
    loginUser,
    getMe,
};
