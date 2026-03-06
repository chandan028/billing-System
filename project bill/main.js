const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Paths
const billsFolder = path.join(__dirname, 'generated_bills');
const configPath = path.join(__dirname, 'bill_config.json');
const recordsFolder = path.join(__dirname, 'billing_records');
const vehicleRegistryPath = path.join(__dirname, 'vehicle_registry.json');
const userVehicleTypesPath = path.join(__dirname, 'user_vehicle_types.json');
const stockCatalogPath = path.join(__dirname, 'stock_catalog.json');
const backupsFolder = path.join(__dirname, 'backups');

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

// Initialize user vehicle types (for autosuggest) if it doesn't exist
if (!fs.existsSync(userVehicleTypesPath)) {
  fs.writeFileSync(userVehicleTypesPath, JSON.stringify([], null, 2));
}

// Initialize stock catalog if it doesn't exist
if (!fs.existsSync(stockCatalogPath)) {
  const initialStock = [
    { name: 'Shell Helix Engine Oil 5L', rate: 0, qty: 0 },
    { name: 'Engine Oil 1L', rate: 0, qty: 0 },
    { name: 'Oil Filter (Swift)', rate: 0, qty: 0 },
    { name: 'Oil Filter (WagonR)', rate: 0, qty: 0 },
    { name: 'Air Filter', rate: 0, qty: 0 },
    { name: 'Fuel Filter', rate: 0, qty: 0 },
    { name: 'Coolant 1L', rate: 0, qty: 0 }
  ];
  fs.writeFileSync(stockCatalogPath, JSON.stringify(initialStock, null, 2));
}

if (!fs.existsSync(backupsFolder)) {
  fs.mkdirSync(backupsFolder, { recursive: true });
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

function recomputeAggregates(data) {
  // Recompute day totals from bills; keep expenses as-is
  let monthTotalBilling = 0;
  let monthBasicAmount = 0;
  let monthSGST = 0;
  let monthCGST = 0;
  let monthLaborPaid = 0;
  let monthOtherExpenditure = 0;
  let monthCashCollected = 0;
  let monthUpiCollected = 0;
  let monthCardCollected = 0;
  let monthTechnicianPayout = 0;

  const days = data.days || {};
  Object.keys(days).forEach(dayKey => {
    const day = days[dayKey];
    const bills = Array.isArray(day.bills) ? day.bills : [];

    let totalBilling = 0;
    let basicAmount = 0;
    let sgstCollected = 0;
    let cgstCollected = 0;
    let cashCollected = 0;
    let upiCollected = 0;
    let cardCollected = 0;
    let technicianPayout = 0;
    const technicianPayouts = {};

    bills.forEach(b => {
      totalBilling += parseFloat(b.grandTotal) || 0;
      basicAmount += parseFloat(b.basicAmount) || 0;
      sgstCollected += parseFloat(b.sgst) || 0;
      cgstCollected += parseFloat(b.cgst) || 0;

      const mode = (b.paymentMode || '').toString().toUpperCase();
      const amt = parseFloat(b.grandTotal) || 0;
      if (mode === 'UPI') upiCollected += amt;
      else if (mode === 'CARD') cardCollected += amt;
      else cashCollected += amt;

      const tech = (b.technicianName || '').toString().trim();
      const sal = parseFloat(b.technicianDaySalary) || 0;
      if (tech && sal > 0) {
        technicianPayout += sal;
        technicianPayouts[tech] = (technicianPayouts[tech] || 0) + sal;
      }
    });

    day.totalBilling = totalBilling;
    day.basicAmount = basicAmount;
    day.sgstCollected = sgstCollected;
    day.cgstCollected = cgstCollected;
    day.cashCollected = cashCollected;
    day.upiCollected = upiCollected;
    day.cardCollected = cardCollected;
    day.technicianPayout = technicianPayout;
    day.technicianPayouts = technicianPayouts;

    monthTotalBilling += totalBilling;
    monthBasicAmount += basicAmount;
    monthSGST += sgstCollected;
    monthCGST += cgstCollected;
    monthCashCollected += cashCollected;
    monthUpiCollected += upiCollected;
    monthCardCollected += cardCollected;
    monthTechnicianPayout += technicianPayout;

    monthLaborPaid += day.laborPaid || 0;
    monthOtherExpenditure += day.otherExpenditure || 0;
  });

  data.monthTotalBilling = monthTotalBilling;
  data.monthBasicAmount = monthBasicAmount;
  data.monthSGST = monthSGST;
  data.monthCGST = monthCGST;
  data.monthLaborPaid = monthLaborPaid;
  data.monthOtherExpenditure = monthOtherExpenditure;
  data.monthCashCollected = monthCashCollected;
  data.monthUpiCollected = monthUpiCollected;
  data.monthCardCollected = monthCardCollected;
  data.monthTechnicianPayout = monthTechnicianPayout;

  return data;
}

function readStockCatalog() {
  if (!fs.existsSync(stockCatalogPath)) return [];
  try {
    const data = fs.readFileSync(stockCatalogPath, 'utf8');
    const items = JSON.parse(data);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeStockCatalog(items) {
  fs.writeFileSync(stockCatalogPath, JSON.stringify(items, null, 2));
}

function normalizeItemName(name) {
  return (name || '').toString().trim().toLowerCase();
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
        otherExpenditure: 0,
        cashCollected: 0,
        upiCollected: 0,
        cardCollected: 0,
        technicianPayout: 0,
        technicianPayouts: {}
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

    // Deduct stock (best-effort): match item particulars to stock name
    try {
      const catalog = readStockCatalog();
      const updated = [...catalog];
      const items = Array.isArray(record.items) ? record.items : [];
      items.forEach(it => {
        const name = normalizeItemName(it.particulars);
        const qty = parseFloat(it.qty) || 0;
        if (!name || qty <= 0) return;
        const idx = updated.findIndex(s => normalizeItemName(s.name) === name);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            qty: Math.max(0, (parseFloat(updated[idx].qty) || 0) - qty)
          };
        }
      });
      writeStockCatalog(updated);
    } catch (err) {
      console.error('Stock deduct error:', err);
    }

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

    // Track user vehicle types for autosuggest
    try {
      const make = (record.vehicleMake || '').toString().trim();
      if (make) {
        let types = [];
        if (fs.existsSync(userVehicleTypesPath)) {
          types = JSON.parse(fs.readFileSync(userVehicleTypesPath, 'utf8'));
        }
        if (!types.includes(make)) {
          types.push(make);
          fs.writeFileSync(userVehicleTypesPath, JSON.stringify(types, null, 2));
        }
      }
    } catch (err) {
      console.error('Error updating user vehicle types:', err);
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving bill record:', error);
    return { success: false, error: error.message };
  }
});

// Update an existing bill record (replace in JSON + recompute totals)
ipcMain.handle('update-bill-record', async (event, { originalBillDate, originalBillNumber, updatedRecord }) => {
  try {
    const [year, month, day] = String(originalBillDate).split('-');
    const YYYYMM = `${year}-${month}`;
    const filePath = ensureMonthFile(YYYYMM);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!data.days || !data.days[day]) {
      return { success: false, error: 'Original bill day not found in records' };
    }

    const bills = Array.isArray(data.days[day].bills) ? data.days[day].bills : [];
    const idx = bills.findIndex(b => String(b.billNumber) === String(originalBillNumber));
    if (idx === -1) {
      return { success: false, error: 'Original bill not found in records' };
    }

    // Keep identity stable
    updatedRecord.billDate = originalBillDate;
    updatedRecord.billNumber = originalBillNumber;

    bills[idx] = updatedRecord;
    data.days[day].bills = bills;

    recomputeAggregates(data);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // NOTE: we do NOT adjust stock on edit automatically (to avoid double-deduct or complex diffing).
    // Stock is deducted only on new bill save. If you want stock correction on edit, we can add it later.

    // Update vehicle registry and vehicle types too (re-use logic from save-bill-record)
    try {
      const billDate = originalBillDate;
      let registry = {};
      if (fs.existsSync(vehicleRegistryPath)) {
        registry = JSON.parse(fs.readFileSync(vehicleRegistryPath, 'utf8'));
      }
      const key = (updatedRecord.vehicleNumber || '').toUpperCase().replace(/\s+/g, '');
      if (key) {
        registry[key] = {
          customerName: updatedRecord.customerName || '',
          customerPhone: updatedRecord.customerPhone || '',
          vehicleMake: updatedRecord.vehicleMake || '',
          lastUpdated: billDate
        };
        fs.writeFileSync(vehicleRegistryPath, JSON.stringify(registry, null, 2));
      }

      const make = (updatedRecord.vehicleMake || '').toString().trim();
      if (make) {
        let types = [];
        if (fs.existsSync(userVehicleTypesPath)) {
          types = JSON.parse(fs.readFileSync(userVehicleTypesPath, 'utf8'));
        }
        if (!types.includes(make)) {
          types.push(make);
          fs.writeFileSync(userVehicleTypesPath, JSON.stringify(types, null, 2));
        }
      }
    } catch (err) {
      console.error('Post-update registry/types error:', err);
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating bill record:', error);
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

// Return user-saved vehicle types for autosuggest
ipcMain.handle('get-user-vehicle-types', async () => {
  try {
    if (!fs.existsSync(userVehicleTypesPath)) {
      return { success: true, types: [] };
    }
    const data = fs.readFileSync(userVehicleTypesPath, 'utf8');
    const types = JSON.parse(data);
    if (Array.isArray(types)) {
      return { success: true, types };
    }
    return { success: true, types: [] };
  } catch (error) {
    console.error('Error reading user vehicle types:', error);
    return { success: false, types: [], error: error.message };
  }
});

// ----- Stock management -----
ipcMain.handle('get-stock-catalog', async () => {
  try {
    return { success: true, items: readStockCatalog() };
  } catch (error) {
    return { success: false, items: [], error: error.message };
  }
});

ipcMain.handle('upsert-stock-item', async (event, { name, rate, qty }) => {
  try {
    const cleanName = (name || '').toString().trim();
    if (!cleanName) return { success: false, error: 'Missing item name' };
    const r = parseFloat(rate) || 0;
    const q = parseFloat(qty) || 0;
    const catalog = readStockCatalog();
    const idx = catalog.findIndex(s => normalizeItemName(s.name) === normalizeItemName(cleanName));
    if (idx >= 0) {
      catalog[idx] = { ...catalog[idx], name: cleanName, rate: r, qty: q };
    } else {
      catalog.push({ name: cleanName, rate: r, qty: q });
    }
    writeStockCatalog(catalog);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ----- Export month to CSV (Excel friendly) -----
ipcMain.handle('export-month-csv', async (event, { YYYYMM }) => {
  try {
    const filePath = getMonthFilePath(YYYYMM);
    if (!fs.existsSync(filePath)) return { success: false, error: 'Month record not found' };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const rows = [];
    rows.push([
      'billDate','billNumber','billType','vehicleNumber','customerName','customerPhone',
      'grandTotal','basicAmount','sgst','cgst','paymentMode','technicianName','technicianDaySalary','fileName'
    ]);

    const days = data.days || {};
    Object.keys(days).sort((a,b)=>parseInt(a,10)-parseInt(b,10)).forEach(dayKey => {
      const bills = Array.isArray(days[dayKey].bills) ? days[dayKey].bills : [];
      bills.forEach(b => {
        rows.push([
          b.billDate || '',
          b.billNumber || '',
          b.billType || '',
          b.vehicleNumber || '',
          b.customerName || '',
          b.customerPhone || '',
          (parseFloat(b.grandTotal)||0).toFixed(2),
          (parseFloat(b.basicAmount)||0).toFixed(2),
          (parseFloat(b.sgst)||0).toFixed(2),
          (parseFloat(b.cgst)||0).toFixed(2),
          b.paymentMode || '',
          b.technicianName || '',
          (parseFloat(b.technicianDaySalary)||0).toFixed(2),
          b.fileName || ''
        ]);
      });
    });

    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '');
      const escaped = s.replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',')).join('\n');

    const outName = `Export_${YYYYMM}_FixPlus.csv`;
    const outPath = path.join(billsFolder, outName);
    fs.writeFileSync(outPath, csv, 'utf8');
    return { success: true, fileName: outName, filePath: outPath };
  } catch (error) {
    console.error('Export CSV error:', error);
    return { success: false, error: error.message };
  }
});

// ----- Backup & clear -----
ipcMain.handle('backup-and-clear-bills', async () => {
  try {
    const archiver = require('archiver');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outName = `FixPlus_Backup_${stamp}.zip`;
    const outPath = path.join(backupsFolder, outName);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      if (fs.existsSync(billsFolder)) archive.directory(billsFolder, 'generated_bills');
      if (fs.existsSync(recordsFolder)) archive.directory(recordsFolder, 'billing_records');
      if (fs.existsSync(stockCatalogPath)) archive.file(stockCatalogPath, { name: 'stock_catalog.json' });
      if (fs.existsSync(vehicleRegistryPath)) archive.file(vehicleRegistryPath, { name: 'vehicle_registry.json' });
      if (fs.existsSync(userVehicleTypesPath)) archive.file(userVehicleTypesPath, { name: 'user_vehicle_types.json' });
      if (fs.existsSync(configPath)) archive.file(configPath, { name: 'bill_config.json' });

      archive.finalize();
    });

    // Clear billing records and generated PDFs after successful zip
    if (fs.existsSync(recordsFolder)) {
      fs.readdirSync(recordsFolder).forEach(f => {
        if (f.endsWith('.json')) fs.unlinkSync(path.join(recordsFolder, f));
      });
    }
    if (fs.existsSync(billsFolder)) {
      fs.readdirSync(billsFolder).forEach(f => {
        if (f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.csv')) {
          fs.unlinkSync(path.join(billsFolder, f));
        }
      });
    }

    return { success: true, fileName: outName, filePath: outPath };
  } catch (error) {
    console.error('Backup & clear error:', error);
    return { success: false, error: error.message };
  }
});
