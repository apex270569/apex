const express = require('express');
const cors = require('cors');
require('dotenv').config();
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// ===== RUTA DE PRUEBA =====
app.get('/', (req, res) => {
    res.json({ mensaje: '🚀 Backend funcionando correctamente' });
});

// ===== REGISTRO DE USUARIO =====
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, nombre, apellido } = req.body;
        
        console.log('📝 Registrando usuario:', username);

        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const userExists = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1 OR email = $2',
            [username, email]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Usuario ya existe' });
        }

        const { ethers } = require('ethers');
        const wallet = ethers.Wallet.createRandom();
        const polygonAddress = wallet.address;
        const privateKey = wallet.privateKey;

        const result = await pool.query(
            `INSERT INTO usuarios 
             (username, email, password, polygon_address, private_key, balance) 
             VALUES ($1, $2, $3, $4, $5, 0) 
             RETURNING id, username, email, polygon_address`,
            [username, email, password, polygonAddress, privateKey]
        );

        console.log('✅ Usuario registrado:', result.rows[0]);

        res.status(201).json({
            mensaje: '✅ Usuario registrado con éxito',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// ===== ACTUALIZAR BALANCE =====
app.get('/api/update-balance/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const result = await pool.query(
            'SELECT polygon_address FROM usuarios WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const address = result.rows[0].polygon_address;
        console.log('🔍 Consultando balance para:', address);

        // 1. BALANCE DE MATIC
        const maticUrl = `https://api.polygonscan.com/api?module=account&action=balance&address=${address}&tag=latest&apikey=S7MZ5FI2VPQ8KSW7NC7YGM9MB4EJ92JHDA`;
        const maticResponse = await axios.get(maticUrl);
        console.log('📊 MATIC Response:', maticResponse.data);

        let maticBalance = 0;
        if (maticResponse.data.status === '1') {
            maticBalance = Number(maticResponse.data.result) / 1e18;
        }

        // 2. BALANCE DE USDT (API V2)
const USDT_CONTRACT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const usdtUrl = `https://api.polygonscan.com/api/v2/account/tokenbalance/${address}/${USDT_CONTRACT}`;
console.log('📡 Consultando USDT V2:', usdtUrl);

let usdtBalance = 0;
try {
    const usdtResponse = await axios.get(usdtUrl);
    console.log('📊 USDT Response V2:', usdtResponse.data);
    
    // V2 devuelve el balance directamente como número
    if (usdtResponse.data && typeof usdtResponse.data === 'number') {
        usdtBalance = usdtResponse.data / 1e18;
    } else if (usdtResponse.data && usdtResponse.data.balance) {
        usdtBalance = usdtResponse.data.balance / 1e18;
    }
} catch (usdtError) {
    console.log('⚠️ Error obteniendo USDT:', usdtError.message);
}

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

app.listen(PORT, () => {
    console.log(`✅ Servidor en puerto ${PORT}`);
});