const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 10000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// ===== POOL DE CONEXIÓN (ÚNICO) =====
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ===== RUTAS =====

// 1. RAIZ
app.get('/', (req, res) => {
    res.json({ 
        mensaje: '🚀 Backend APEX funcionando',
        status: 'online',
        timestamp: new Date().toISOString()
    });
});

// 2. REGISTRO
app.post('/api/register', async (req, res) => {
    try {
        const { telefono, nombre, apellido, password } = req.body;
        
        // Validar
        if (!telefono || !nombre || !apellido || !password) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        // Verificar si el teléfono ya existe
        const userExists = await pool.query(
            'SELECT * FROM usuarios WHERE telefono = $1',
            [telefono]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Usuario ya existe' });
        }

        // Generar dirección Polygon
        const wallet = ethers.Wallet.createRandom();
        const polygonAddress = wallet.address;
        const privateKey = wallet.privateKey;

        // Guardar en la base de datos
        const result = await pool.query(
            `INSERT INTO usuarios 
             (telefono, nombre, apellido, password, polygon_address, private_key, balance, puntos, plan) 
             VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 'Sin plan') 
             RETURNING id, telefono, nombre, apellido, polygon_address`,
            [telefono, nombre, apellido, password, polygonAddress, privateKey]
        );

        res.status(201).json({
            success: true,
            mensaje: '✅ Usuario registrado con éxito',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 3. LOGIN (¡NUEVO!)
app.post('/api/login', async (req, res) => {
    try {
        const { telefono, password } = req.body;
        
        if (!telefono || !password) {
            return res.status(400).json({ error: 'Teléfono y contraseña requeridos' });
        }

        const result = await pool.query(
            'SELECT * FROM usuarios WHERE telefono = $1',
            [telefono]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const user = result.rows[0];
        
        // Verificar contraseña (en producción usar bcrypt)
        if (user.password !== password) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // No enviar private_key al frontend
        delete user.private_key;
        
        res.json({
            success: true,
            mensaje: '✅ Login exitoso',
            usuario: user
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 4. OBTENER USUARIO POR TELÉFONO (para el dashboard)
app.get('/api/usuario/:telefono', async (req, res) => {
    try {
        const { telefono } = req.params;
        
        const result = await pool.query(
            'SELECT id, telefono, nombre, apellido, polygon_address, balance, puntos, plan, direccion_retiro, historial, referidos, produccion_pausada, cuenta_habilitada FROM usuarios WHERE telefono = $1',
            [telefono]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({
            success: true,
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

// 5. ACTUALIZAR BALANCE
app.get('/api/update-balance/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(
            'SELECT polygon_address FROM usuarios WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const address = result.rows[0].polygon_address;

        // Conectar a Polygon
        const provider = new ethers.providers.JsonRpcProvider(
            'https://polygon-mainnet.infura.io/v3/b5e9b89613a14216bb048abf46e2b703'
        );
        
        // Balance MATIC
        const maticBalanceWei = await provider.getBalance(address);
        const maticBalance = parseFloat(ethers.utils.formatEther(maticBalanceWei));

        // Balance USDT
        const USDT_CONTRACT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
        const usdtAbi = [
            'function balanceOf(address owner) view returns (uint256)',
            'function decimals() view returns (uint8)'
        ];
        const contract = new ethers.Contract(USDT_CONTRACT, usdtAbi, provider);
        
        let usdtBalance = 0;
        try {
            const usdtBalanceWei = await contract.balanceOf(address);
            const decimals = await contract.decimals();
            usdtBalance = parseFloat(usdtBalanceWei) / Math.pow(10, decimals);
        } catch (error) {
            console.log('⚠️ Error obteniendo USDT:', error.message);
        }

        // Actualizar en BD
        await pool.query(
            'UPDATE usuarios SET balance = $1 WHERE id = $2',
            [maticBalance.toString(), userId]
        );

        res.json({
            success: true,
            address: address,
            matic: maticBalance.toFixed(4) + ' MATIC',
            usdt: usdtBalance.toFixed(2) + ' USDT'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            error: 'Error al actualizar balance: ' + error.message 
        });
    }
});

// 6. OBTENER TODOS LOS USUARIOS (Admin)
app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                telefono,
                nombre,
                apellido,
                polygon_address,
                balance,
                puntos,
                plan,
                produccion_pausada,
                cuenta_habilitada,
                direccion_retiro,
                historial,
                referidos
            FROM usuarios 
            ORDER BY id DESC
        `);
        
        res.json({
            success: true,
            usuarios: result.rows
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// 7. ACTUALIZAR USUARIOS (Admin)
app.post('/api/usuarios/update', async (req, res) => {
    try {
        const { usuarios } = req.body;
        
        if (!usuarios || !Array.isArray(usuarios)) {
            return res.status(400).json({ error: 'Se requiere un array de usuarios' });
        }

        // Actualizar cada usuario
        for (const user of usuarios) {
            await pool.query(
                `UPDATE usuarios SET 
                    balance = $1, 
                    plan = $2, 
                    puntos = $3,
                    produccion_pausada = $4,
                    cuenta_habilitada = $5,
                    direccion_retiro = $6
                WHERE telefono = $7`,
                [
                    user.balance || 0,
                    user.plan || 'Sin plan',
                    user.puntos || 0,
                    user.produccion_pausada || false,
                    user.cuenta_habilitada !== false,
                    user.direccion_retiro || null,
                    user.telefono
                ]
            );
        }

        res.json({ 
            success: true, 
            message: '✅ Usuarios actualizados correctamente' 
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            error: 'Error al actualizar usuarios: ' + error.message 
        });
    }
});

// 8. ACTUALIZAR UN USUARIO ESPECÍFICO
app.put('/api/usuario/:telefono', async (req, res) => {
    try {
        const { telefono } = req.params;
        const { balance, puntos, plan, direccion_retiro, produccion_pausada, cuenta_habilitada } = req.body;

        const result = await pool.query(
            `UPDATE usuarios SET 
                balance = COALESCE($1, balance),
                puntos = COALESCE($2, puntos),
                plan = COALESCE($3, plan),
                direccion_retiro = COALESCE($4, direccion_retiro),
                produccion_pausada = COALESCE($5, produccion_pausada),
                cuenta_habilitada = COALESCE($6, cuenta_habilitada)
            WHERE telefono = $7
            RETURNING *`,
            [balance, puntos, plan, direccion_retiro, produccion_pausada, cuenta_habilitada, telefono]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({
            success: true,
            mensaje: '✅ Usuario actualizado',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// ===== INICIAR SERVIDOR =====
app.listen(PORT, () => {
    console.log(`✅ Servidor APEX corriendo en puerto ${PORT}`);
    console.log(`📡 Base de datos: ${process.env.DATABASE_URL ? 'Conectada' : 'Sin conexión'}`);
});