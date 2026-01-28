const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Create generated_bills folder if it doesn't exist
const billsFolder = path.join(__dirname, 'generated_bills');
if (!fs.existsSync(billsFolder)) {
  fs.mkdirSync(billsFolder);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development (comment out for production)
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
    const buffer = Buffer.from(pdfData.split(',')[1], 'base64');

    // Write file
    fs.writeFileSync(filePath, buffer);

    return { success: true, filePath };
  } catch (error) {
    console.error('Error saving PDF:', error);
    return { success: false, error: error.message };
  }
});

// Get next bill number
ipcMain.handle('get-next-bill-number', async () => {
  try {
    const configPath = path.join(__dirname, 'bill_config.json');
    let config = { lastBillNumber: 185 };

    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(data);
    }

    return config.lastBillNumber;
  } catch (error) {
    console.error('Error getting bill number:', error);
    return 185;
  }
});

// Save bill number
ipcMain.handle('save-bill-number', async (event, billNumber) => {
  try {
    const configPath = path.join(__dirname, 'bill_config.json');
    const config = { lastBillNumber: billNumber };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving bill number:', error);
    return { success: false, error: error.message };
  }
});

// Open bills folder
ipcMain.handle('open-bills-folder', async () => {
  try {
    const { shell } = require('electron');
    shell.openPath(billsFolder);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
