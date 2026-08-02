const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ mensaje: '🚀 Backend funcionando correctamente' });
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, nombre, apellido } = req.body;
        
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

        res.status(201).json({
            mensaje: '✅ Usuario registrado con éxito',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
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

        // Conectar a Polygon usando RPC pública
       const provider = new ethers.providers.JsonRpcProvider('https://polygon-mainnet.infura.io/v3/https://polygon-mainnet.infura.io/v3/b5e9b89613a14216bb048abf46e2b703');
        
        // 1. BALANCE DE MATIC
        const maticBalanceWei = await provider.getBalance(address);
        const maticBalance = parseFloat(ethers.utils.formatEther(maticBalanceWei));

        // 2. BALANCE DE USDT
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