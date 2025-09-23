// En: backend/middleware/authMiddleware.js

const jwt = require('jsonwebtoken');
// Importamos 'db' desde nuestra configuración centralizada
const { db } = require('../config/db');

// Ya no necesitamos el modelo de Mongoose
// const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // 1. Obtener el token del header (esto no cambia)
      token = req.headers.authorization.split(' ')[1];

      // 2. Verificar el token (esto no cambia)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // --- 3. CAMBIO PRINCIPAL: Buscar el usuario en Firestore ---
      // En lugar de User.findById(decoded.id), usamos db.collection(...).doc(...).get()
      const userDoc = await db.collection('users').doc(decoded.id).get();

      // Si el documento no existe, el usuario no es válido.
      if (!userDoc.exists) {
        return res.status(401).json({ message: 'No autorizado, usuario no encontrado' });
      }

      // Creamos el objeto req.user con los datos de Firestore.
      // Es importante mantener el ID del documento.
      const userData = userDoc.data();
      req.user = {
        _id: userDoc.id, // Mantenemos _id para consistencia
        name: userData.name,
        email: userData.email,
        // No incluimos la contraseña, tal como hacía .select('-password')
      };

      // Si todo está correcto, continuamos con la siguiente función (el controlador de la ruta).
      next();
    } catch (error) {
      console.error("Error en el middleware de protección:", error);
      res.status(401).json({ message: 'No autorizado, el token falló' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'No autorizado, no hay token' });
  }
};

module.exports = { protect };