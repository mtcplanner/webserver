const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const { Readable } = require('stream');
const path = require('path');

const app = express();

// Header agar diizinkan masuk ke dalam Iframe Portal
app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    next();
});
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

// Konfigurasi Kredensial Google API dari Environment Variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'https://developers.google.com/oauthplayground';
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const DEFAULT_ROOT_FOLDER = process.env.ROOT_FOLDER_ID || '1iiXgkg55_ip97vFTd7IBCjI1Rc3gKxUm1lDXrX8wppc';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });
const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

const SPREADSHEET_ID = '1YRlPOagZaZNkXwiKUe2X7d_iQjnqOc3IT5Oi1dBkodg';

// API Verifikasi Login (KHUSUS DEVELOPER)
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Membaca Kolom A sampai E (Username, Password, Nama, Email, Level)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A:E',
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json({ success: false, message: 'Data user tidak ditemukan!' });
        }

        let userFound = false;
        let isDeveloper = false;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const sheetUser = row[0] ? row[0].trim().toLowerCase() : '';
            const sheetPass = row[1] ? row[1].trim() : '';
            const sheetLevel = row[4] ? row[4].trim().toLowerCase() : 'user';

            if (sheetUser === username.trim().toLowerCase() && sheetPass === password) {
                userFound = true;
                if (sheetLevel === 'developer') {
                    isDeveloper = true;
                }
                break;
            }
        }

        if (userFound && isDeveloper) {
            return res.json({ success: true, message: 'Login Berhasil' });
        } else if (userFound && !isDeveloper) {
            return res.json({ success: false, message: 'Akses ditolak! Hanya akun Developer yang diizinkan.' });
        } else {
            return res.json({ success: false, message: 'Username atau Password salah!' });
        }
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ success: false, message: 'Gagal menghubungi database spreadsheet' });
    }
});

// API Ambil File / Folder (Dengan Root Folder Baru)
app.get('/api/files', async (req, res) => {
    try {
        let folderId = req.query.folderId;
        if (!folderId || folderId === 'root') {
            folderId = DEFAULT_ROOT_FOLDER;
        }
        
        const sortBy = req.query.sortBy || 'folder,name'; 

        const response = await drive.files.list({
            pageSize: 100,
            fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)',
            q: `'${folderId}' in parents and trashed = false`,
            orderBy: sortBy
        });
        res.json(response.data.files);
    } catch (error) {
        console.error('Error fetching files:', error.message);
        res.status(500).json({ error: 'Gagal mengambil file' });
    }
});

// API Buat Folder Baru
app.post('/api/create-folder', async (req, res) => {
    try {
        let { name, parentId } = req.body;
        if (!parentId || parentId === 'root') parentId = DEFAULT_ROOT_FOLDER;

        const fileMetadata = {
            name: name || 'Folder Baru',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        };
        const folder = await drive.files.create({ resource: fileMetadata, fields: 'id, name' });
        res.json({ success: true, folder: folder.data });
    } catch (error) {
        res.status(500).json({ error: 'Gagal membuat folder' });
    }
});

// API Buat File (Spreadsheet / Dokumen)
app.post('/api/create-file', async (req, res) => {
    try {
        let { name, type, parentId } = req.body;
        if (!parentId || parentId === 'root') parentId = DEFAULT_ROOT_FOLDER;

        let mimeType = 'application/vnd.google-apps.document';
        if (type === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';

        const fileMetadata = {
            name: name || 'File Baru',
            mimeType: mimeType,
            parents: [parentId]
        };
        const file = await drive.files.create({ resource: fileMetadata, fields: 'id, name, mimeType, webViewLink' });
        res.json({ success: true, file: file.data });
    } catch (error) {
        res.status(500).json({ error: 'Gagal membuat file' });
    }
});

// API Upload File
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        let parentId = req.body.parentId;
        if (!parentId || parentId === 'root') parentId = DEFAULT_ROOT_FOLDER;

        if (!req.file) return res.status(400).json({ error: 'File tidak ada' });

        const fileStream = new Readable();
        fileStream.push(req.file.buffer);
        fileStream.push(null);

        const response = await drive.files.create({
            resource: { name: req.file.originalname, parents: [parentId] },
            media: { mimeType: req.file.mimetype, body: fileStream },
            fields: 'id, name'
        });
        res.json({ success: true, file: response.data });
    } catch (error) {
        res.status(500).json({ error: 'Gagal upload' });
    }
});

// API Hapus File
app.delete('/api/files/:id', async (req, res) => {
    try {
        await drive.files.delete({ fileId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghapus' });
    }
});

// API Rename File/Folder
app.put('/api/files/:id/rename', async (req, res) => {
    try {
        const { newName } = req.body;
        if (!newName) return res.status(400).json({ error: 'Nama baru tidak boleh kosong' });

        const response = await drive.files.update({
            fileId: req.params.id,
            resource: { name: newName },
            fields: 'id, name'
        });
        
        res.json({ success: true, file: response.data });
    } catch (error) {
        console.error('Error renaming:', error.message);
        res.status(500).json({ error: 'Gagal mengubah nama' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server Cloud WebOS aktif di port ${PORT}`);
});
