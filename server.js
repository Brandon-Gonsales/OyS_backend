// En: backend/server.js

// --- SECCIÓN 1: CONFIGURACIÓN INICIAL ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- SECCIÓN 2: IMPORTACIÓN DE RUTAS ---
// Importamos los archivos que definen nuestras rutas.
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes'); // <-- El nuevo archivo que creamos

// --- SECCIÓN 3: CREACIÓN Y CONFIGURACIÓN DE LA APP EXPRESS ---
const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares globales (estos se mantienen igual)
const allowedOrigins = [
  'https://oy-s-frontend-git-master-brandon-gonsales-projects.vercel.app',
  'https://oy-s-frontend-git-develop-brandon-gonsales-projects.vercel.app',               
  'http://localhost:3000',
  'https://oy-s-frontend.vercel.app'
];
const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por la política de CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- SECCIÓN 4: "MONTAR" LAS RUTAS ---
// Aquí le decimos a nuestra aplicación que use los archivos de rutas que importamos.
// Cualquier petición que empiece con /api/users será manejada por userRoutes.
app.use('/api/users', userRoutes);
// Cualquier petición que empiece con /api/chats será manejada por nuestro nuevo chatRoutes.
app.use('/api/chats', chatRoutes);


// --- SECCIÓN 5: INICIAR EL SERVIDOR ---
app.listen(PORT, () => console.log(`Servidor backend corriendo en http://localhost:${PORT}`));