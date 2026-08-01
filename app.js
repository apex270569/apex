const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ mensaje: '🚀 Backend funcionando correctamente' });
});

// Iniciar servidor
// ===== REGISTRO DE USUARIO =====
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, nombre, apellido, codigoInvitacion } = req.body;
        
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        // Verificar si el usuario ya existe
        const userExists = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1 OR email = $2',
            [username, email]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Usuario ya existe' });
        }

        // Generar dirección Polygon
        const Web3 = require('web3');
        const HDWalletProvider = require('@truffle/hdwallet-provider');
        const provider = new HDWalletProvider({
            mnemonic: process.env.MNEMONIC,
            providerOrUrl: process.env.POLYGON_RPC_URL
        });
        const web3 = new Web3(provider);
        const account = web3.eth.accounts.create();
        const polygonAddress = account.address;

        // Guardar en la base de datos
        const result = await pool.query(
            `INSERT INTO usuarios 
             (username, email, password, polygon_address, private_key, balance) 
             VALUES ($1, $2, $3, $4, $5, 0) 
             RETURNING id, username, email, polygon_address`,
            [username, email, password, polygonAddress, account.privateKey]
        );

        res.status(201).json({
            mensaje: '✅ Usuario registrado con éxito',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error:', error);
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

        const Web3 = require('web3');
        const web3 = new Web3(process.env.POLYGON_RPC_URL);
        const balanceWei = await web3.eth.getBalance(address);
        const balanceEth = web3.utils.fromWei(balanceWei, 'ether');

        await pool.query(
            'UPDATE usuarios SET balance = $1 WHERE id = $2',
            [balanceEth, userId]
        );

        res.json({
            success: true,
            address: address,
            balance: balanceEth + ' MATIC'
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar balance' });
    }
});
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});