const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Paths
const billsFolder = path.join(__dirname, 'generated_bills');
const configPath = path.join(__dirname, 'bill_config.json');

// Create generated_bills folder if it doesn't exist
if (!fs.existsSync(billsFolder)) {
  fs.mkdirSync(billsFolder, { recursive: true });
}

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ lastBillNumber: 185 }, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'logo.png')
  });

  mainWindow.loadFile('index.html');

  // Uncomment to open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle save PDF request from renderer
ipcMain.handle('save-pdf', async (event, { pdfData, fileName }) => {
  try {
    const filePath = path.join(billsFolder, fileName);

    // Convert base64 to buffer
    const base64Data = pdfData.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // Write file synchronously
    fs.writeFileSync(filePath, buffer);

    console.log('PDF saved to:', filePath);
    return { success: true, filePath };
  } catch (error) {
    console.error('Error saving PDF:', error);
    return { success: false, error: error.message };
  }
});

// Get next bill number
ipcMain.handle('get-next-bill-number', async () => {
  try {
    // Read current config
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      console.log('Current bill number from config:', config.lastBillNumber);
      return config.lastBillNumber || 185;
    } else {
      // Create default config
      const defaultConfig = { lastBillNumber: 185 };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log('Created default config with bill number: 185');
      return 185;
    }
  } catch (error) {
    console.error('Error getting bill number:', error);
    return 185;
  }
});

// Save bill number
ipcMain.handle('save-bill-number', async (event, billNumber) => {
  try {
    const config = { lastBillNumber: parseInt(billNumber) };

    // Write synchronously to ensure it's saved
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    // Verify write
    const verifyData = fs.readFileSync(configPath, 'utf8');
    const verifyConfig = JSON.parse(verifyData);

    console.log('Bill number saved:', billNumber);
    console.log('Verified config:', verifyConfig);

    return { success: true, savedNumber: verifyConfig.lastBillNumber };
  } catch (error) {
    console.error('Error saving bill number:', error);
    return { success: false, error: error.message };
  }
});

// Open bills folder
ipcMain.handle('open-bills-folder', async () => {
  try {
    await shell.openPath(billsFolder);
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});
