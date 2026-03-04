const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Paths
const billsFolder = path.join(__dirname, 'generated_bills');
const configPath = path.join(__dirname, 'bill_config.json');
const recordsFolder = path.join(__dirname, 'billing_records');
const vehicleRegistryPath = path.join(__dirname, 'vehicle_registry.json');

// Create generated_bills folder if it doesn't exist
if (!fs.existsSync(billsFolder)) {
  fs.mkdirSync(billsFolder, { recursive: true });
}

// Create billing_records folder for JSON audit data
if (!fs.existsSync(recordsFolder)) {
  fs.mkdirSync(recordsFolder, { recursive: true });
}

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ lastBillNumber: 0 }, null, 2));
}

// Initialize vehicle registry if it doesn't exist
if (!fs.existsSync(vehicleRegistryPath)) {
  fs.writeFileSync(vehicleRegistryPath, JSON.stringify({}, null, 2));
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
      return config.lastBillNumber || 0;
    } else {
      // Create default config
      const defaultConfig = { lastBillNumber: 0 };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log('Created default config with bill number: 0');
      return 0;
    }
  } catch (error) {
    console.error('Error getting bill number:', error);
    return 0;
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

// Open specific PDF file
ipcMain.handle('open-pdf-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error opening PDF:', error);
    return { success: false, error: error.message };
  }
});

// ----- Billing records & audit -----

function getMonthFilePath(YYYYMM) {
  return path.join(recordsFolder, `${YYYYMM}.json`);
}

function ensureMonthFile(YYYYMM) {
  const filePath = getMonthFilePath(YYYYMM);
  if (!fs.existsSync(filePath)) {
    const [year, month] = YYYYMM.split('-');
    const initial = {
      year: parseInt(year, 10),
      month: parseInt(month, 10),
      days: {},
      monthTotalBilling: 0,
      monthBasicAmount: 0,
      monthSGST: 0,
      monthCGST: 0,
      monthLaborPaid: 0,
      monthOtherExpenditure: 0
    };
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
  }
  return filePath;
}

// Save a single bill to day-wise and month-wise JSON; update vehicle registry
ipcMain.handle('save-bill-record', async (event, record) => {
  try {
    const billDate = record.billDate; // YYYY-MM-DD
    const [year, month, day] = billDate.split('-');
    const YYYYMM = `${year}-${month}`;

    const filePath = ensureMonthFile(YYYYMM);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!data.days[day]) {
      data.days[day] = {
        date: billDate,
        bills: [],
        totalBilling: 0,
        basicAmount: 0,
        sgstCollected: 0,
        cgstCollected: 0,
        laborPaid: 0,
        otherExpenditure: 0
      };
    }

    const dayData = data.days[day];
    dayData.bills.push(record);
    const grandTotal = parseFloat(record.grandTotal) || 0;
    const basic = parseFloat(record.basicAmount) || 0;
    const sgst = parseFloat(record.sgst) || 0;
    const cgst = parseFloat(record.cgst) || 0;

    dayData.totalBilling += grandTotal;
    dayData.basicAmount += basic;
    dayData.sgstCollected += sgst;
    dayData.cgstCollected += cgst;

    data.monthTotalBilling = (data.monthTotalBilling || 0) + grandTotal;
    data.monthBasicAmount = (data.monthBasicAmount || 0) + basic;
    data.monthSGST = (data.monthSGST || 0) + sgst;
    data.monthCGST = (data.monthCGST || 0) + cgst;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Update vehicle registry
    const regPath = vehicleRegistryPath;
    let registry = {};
    if (fs.existsSync(regPath)) {
      registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    }
    const key = (record.vehicleNumber || '').toUpperCase().replace(/\s+/g, '');
    if (key) {
      registry[key] = {
        customerName: record.customerName || '',
        customerPhone: record.customerPhone || '',
        vehicleMake: record.vehicleMake || '',
        lastUpdated: billDate
      };
      fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving bill record:', error);
    return { success: false, error: error.message };
  }
});

// Get vehicle info by number (for pre-fill)
ipcMain.handle('get-vehicle-by-number', async (event, vehicleNumber) => {
  try {
    if (!vehicleNumber || !vehicleNumber.trim()) return { success: true, data: null };
    const key = vehicleNumber.toUpperCase().replace(/\s+/g, '');
    if (!fs.existsSync(vehicleRegistryPath)) return { success: true, data: null };
    const registry = JSON.parse(fs.readFileSync(vehicleRegistryPath, 'utf8'));
    const data = registry[key] || null;
    return { success: true, data };
  } catch (error) {
    console.error('Error getting vehicle:', error);
    return { success: false, error: error.message, data: null };
  }
});

// Get month record (for audit view and PDF)
ipcMain.handle('get-month-records', async (event, YYYYMM) => {
  try {
    const filePath = getMonthFilePath(YYYYMM);
    if (!fs.existsSync(filePath)) {
      return { success: true, data: null };
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { success: true, data };
  } catch (error) {
    console.error('Error getting month records:', error);
    return { success: false, error: error.message, data: null };
  }
});

// List available months (from billing_records folder)
ipcMain.handle('get-available-months', async () => {
  try {
    if (!fs.existsSync(recordsFolder)) return { success: true, months: [] };
    const files = fs.readdirSync(recordsFolder).filter(f => f.endsWith('.json'));
    const months = files.map(f => f.replace('.json', '')).sort().reverse();
    return { success: true, months };
  } catch (error) {
    console.error('Error listing months:', error);
    return { success: false, error: error.message, months: [] };
  }
});

// Update day-wise labor and other expenditure
ipcMain.handle('update-day-expenses', async (event, { YYYYMM, day, laborPaid, otherExpenditure }) => {
  try {
    const filePath = ensureMonthFile(YYYYMM);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.days[day]) {
      data.days[day] = {
        date: `${YYYYMM}-${day.padStart(2, '0')}`,
        bills: [],
        totalBilling: 0,
        basicAmount: 0,
        sgstCollected: 0,
        cgstCollected: 0,
        laborPaid: 0,
        otherExpenditure: 0
      };
    }
    data.days[day].laborPaid = parseFloat(laborPaid) || 0;
    data.days[day].otherExpenditure = parseFloat(otherExpenditure) || 0;

    // Recompute month labor/other from all days
    let monthLabor = 0, monthOther = 0;
    Object.keys(data.days).forEach(d => {
      monthLabor += data.days[d].laborPaid || 0;
      monthOther += data.days[d].otherExpenditure || 0;
    });
    data.monthLaborPaid = monthLabor;
    data.monthOtherExpenditure = monthOther;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error updating day expenses:', error);
    return { success: false, error: error.message };
  }
});
