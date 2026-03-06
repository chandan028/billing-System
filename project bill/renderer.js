const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Logo base64 (will be loaded from file)
let logoBase64 = null;

// Kannada font base64 (will be loaded from file or embedded)
let kannadaFontLoaded = false;

// Store last generated bill data for WhatsApp sharing
let lastBillData = null;

// Predefined vehicle types / makes commonly seen in India
const DEFAULT_VEHICLE_TYPES = [
    'Maruti Suzuki Alto', 'Maruti Suzuki Alto 800', 'Maruti Suzuki Alto K10',
    'Maruti Suzuki Wagon R', 'Maruti Suzuki Swift', 'Maruti Suzuki Swift Dzire',
    'Maruti Suzuki Baleno', 'Maruti Suzuki Celerio', 'Maruti Suzuki Ertiga',
    'Maruti Suzuki Eeco', 'Maruti Suzuki Brezza', 'Maruti Suzuki Grand Vitara',
    'Hyundai Santro', 'Hyundai i10', 'Hyundai Grand i10', 'Hyundai i20', 'Hyundai i20 Elite',
    'Hyundai Venue', 'Hyundai Creta', 'Hyundai Verna', 'Hyundai Aura', 'Hyundai Exter',
    'Tata Tiago', 'Tata Punch', 'Tata Altroz', 'Tata Tigor', 'Tata Nexon', 'Tata Harrier', 'Tata Safari',
    'Mahindra Bolero', 'Mahindra Bolero Neo', 'Mahindra Scorpio', 'Mahindra Scorpio N',
    'Mahindra XUV300', 'Mahindra XUV500', 'Mahindra XUV700', 'Mahindra Thar',
    'Honda Amaze', 'Honda City', 'Honda Jazz', 'Honda WR-V',
    'Toyota Innova', 'Toyota Innova Crysta', 'Toyota Fortuner', 'Toyota Glanza', 'Toyota Urban Cruiser',
    'Kia Seltos', 'Kia Sonet', 'Kia Carens',
    'Renault Kwid', 'Renault Triber', 'Renault Kiger', 'Renault Duster',
    'Nissan Magnite', 'Nissan Kicks',
    'Skoda Rapid', 'Skoda Slavia', 'Skoda Kushaq',
    'Volkswagen Polo', 'Volkswagen Vento', 'Volkswagen Taigun', 'Volkswagen Virtus',
    'MG Hector', 'MG Astor', 'MG ZS EV',
    'Ford Figo', 'Ford Aspire', 'Ford EcoSport', 'Ford Endeavour',
    'Jeep Compass', 'Jeep Meridian',
    'Hyundai i10 Nios', 'Hyundai Grand i10 Nios',
    'SUV', 'Hatchback', 'Sedan', 'MUV', 'MPV', 'Pickup', 'Compact SUV',
    'Tempo Traveller', 'Mini Bus', 'Taxi', 'Private Car'
];

let allVehicleTypes = [...DEFAULT_VEHICLE_TYPES];

// Edit mode state (editing an existing bill)
let editBillContext = null; // { originalBillDate, originalBillNumber, originalFileName }

// Cache latest loaded month data in Audit panel
let currentAuditMonthData = null;

// Stock catalog cache
let stockCatalog = []; // [{ name, rate, qty }]

// Initialize bill number on load
window.addEventListener('DOMContentLoaded', async () => {
    // Load logo
    await loadLogo();

    // Load Kannada font
    await loadKannadaFont();

    // Get and set next bill number
    const lastBillNumber = await ipcRenderer.invoke('get-next-bill-number');
    document.getElementById('billNumber').value = lastBillNumber + 1;

    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('billDate').value = today;

    // Add event listeners
    setupEventListeners();

    // Load vehicle types (user-saved) and set up autosuggest for vehicle make
    await loadVehicleTypes();
    setupVehicleMakeAutosuggest();

    // Load stock catalog and wire autosuggest for billing items
    await loadStockCatalog();
    wireItemsStockAutosuggest();
});

async function loadLogo() {
    try {
        const logoPath = path.join(__dirname, 'logo.png');
        if (fs.existsSync(logoPath)) {
            const logoData = fs.readFileSync(logoPath);
            logoBase64 = 'data:image/png;base64,' + logoData.toString('base64');
            console.log('Logo loaded successfully');
        } else {
            console.log('Logo file not found at:', logoPath);
        }
    } catch (error) {
        console.error('Error loading logo:', error);
    }
}

// Load Kannada font for PDF
async function loadKannadaFont() {
    // Note: jsPDF has limited support for complex scripts like Kannada
    // The font embeds correctly (copy-paste works) but rendering may show boxes
    // Using English fallback for reliable display
    kannadaFontLoaded = false;
    console.log('Using English fallback for footer (Kannada rendering limited in PDF)');
}

function setupEventListeners() {
    // Add item button
    document.getElementById('addItem').addEventListener('click', addItem);

    // Form submission
    document.getElementById('billingForm').addEventListener('submit', generatePDF);

    // Clear form
    document.getElementById('clearForm').addEventListener('click', clearForm);

    // Open folder
    document.getElementById('openFolder').addEventListener('click', openBillsFolder);

    // Calculate totals when items change (light debounce for better typing performance)
    let totalsTimeout = null;
    document.getElementById('itemsBody').addEventListener('input', function () {
        if (totalsTimeout) clearTimeout(totalsTimeout);
        totalsTimeout = setTimeout(calculateTotals, 80);
    });

    // Phone number validation - only allow digits
    document.getElementById('customerPhone').addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '').substring(0, 10);
    });

    // GSTIN validation - uppercase and limit
    document.getElementById('customerGstin').addEventListener('input', function(e) {
        this.value = this.value.toUpperCase().substring(0, 15);
    });

    // Vehicle number lookup: on blur, pre-fill customer/vehicle if found (editable)
    document.getElementById('vehicleNumber').addEventListener('blur', function() {
        const num = this.value.trim();
        if (num.length >= 4) lookupVehicleAndPrefill(num);
    });

    // Audit & Reports
    document.getElementById('auditMonthSelect').addEventListener('change', loadAuditMonth);
    document.getElementById('generateAuditPdf').addEventListener('click', generateAuditPdf);
    document.getElementById('showAuditPanel').addEventListener('click', showAuditPanel);
    document.getElementById('hideAuditPanel').addEventListener('click', hideAuditPanel);
    document.getElementById('editBillDaySelect').addEventListener('change', refreshEditBillList);
    document.getElementById('loadBillForEdit').addEventListener('click', loadSelectedBillForEdit);
    document.getElementById('cancelEditMode').addEventListener('click', cancelEditMode);
    document.getElementById('exportMonthCsv').addEventListener('click', exportMonthCsv);
    document.getElementById('backupAndClear').addEventListener('click', backupAndClear);
    document.getElementById('saveStockItem').addEventListener('click', saveStockItem);

    // WhatsApp button
    document.getElementById('sendWhatsApp').addEventListener('click', showWhatsAppModal);

    // WhatsApp modal buttons
    document.getElementById('confirmWhatsApp').addEventListener('click', sendWhatsApp);
    document.getElementById('cancelWhatsApp').addEventListener('click', hideWhatsAppModal);

    // Close modal on outside click
    document.getElementById('whatsappModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideWhatsAppModal();
        }
    });
}

async function loadVehicleTypes() {
    try {
        const result = await ipcRenderer.invoke('get-user-vehicle-types');
        if (result && result.success && Array.isArray(result.types)) {
            const merged = new Set([
                ...DEFAULT_VEHICLE_TYPES,
                ...result.types.map(v => String(v).trim()).filter(Boolean)
            ]);
            allVehicleTypes = Array.from(merged).sort((a, b) => a.localeCompare(b));
        } else {
            allVehicleTypes = [...DEFAULT_VEHICLE_TYPES];
        }
    } catch (error) {
        console.error('Error loading user vehicle types:', error);
        allVehicleTypes = [...DEFAULT_VEHICLE_TYPES];
    }
}

async function loadStockCatalog() {
    try {
        const result = await ipcRenderer.invoke('get-stock-catalog');
        if (result && result.success && Array.isArray(result.items)) {
            stockCatalog = result.items;
        } else {
            stockCatalog = [];
        }
        refreshStockDatalist();
        renderStockList();
    } catch (error) {
        console.error('Error loading stock catalog:', error);
        stockCatalog = [];
    }
}

function refreshStockDatalist() {
    const dl = document.getElementById('stockSuggestions');
    if (!dl) return;
    dl.innerHTML = '';
    stockCatalog
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .forEach(it => {
            const opt = document.createElement('option');
            opt.value = it.name;
            dl.appendChild(opt);
        });
}

function wireItemsStockAutosuggest() {
    const tbody = document.getElementById('itemsBody');
    if (!tbody) return;

    function attachToRow(row) {
        const part = row.querySelector('.item-particulars');
        if (!part) return;
        part.setAttribute('list', 'stockSuggestions');
        part.addEventListener('change', () => applyStockToRow(row));
        part.addEventListener('blur', () => applyStockToRow(row));
    }

    // Existing rows
    tbody.querySelectorAll('.item-row').forEach(attachToRow);

    // When new items are added, hook them too (use mutation observer)
    const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1 && node.classList.contains('item-row')) {
                    attachToRow(node);
                }
            }
        }
    });
    obs.observe(tbody, { childList: true });
}

function applyStockToRow(row) {
    const part = row.querySelector('.item-particulars');
    const amt = row.querySelector('.item-amount');
    if (!part || !amt) return;
    const name = (part.value || '').trim();
    if (!name) return;
    const match = stockCatalog.find(it => String(it.name).toLowerCase() === name.toLowerCase());
    if (!match) return;
    const current = parseFloat(amt.value);
    // Only auto-fill when amount is empty or 0
    if (!current || current === 0) {
        amt.value = (parseFloat(match.rate) || 0).toFixed(2);
        calculateTotals();
    }
}

async function saveStockItem() {
    const name = (document.getElementById('stockItemName').value || '').trim();
    const rate = parseFloat(document.getElementById('stockItemRate').value) || 0;
    const qty = parseFloat(document.getElementById('stockItemQty').value) || 0;
    if (!name) {
        showNotification('Enter stock item name', 'error');
        return;
    }
    const result = await ipcRenderer.invoke('upsert-stock-item', { name, rate, qty });
    if (!result.success) {
        showNotification('Failed to save stock item: ' + (result.error || ''), 'error');
        return;
    }
    showNotification('Stock item saved');
    await loadStockCatalog();
}

function renderStockList() {
    const el = document.getElementById('stockList');
    if (!el) return;
    if (!stockCatalog.length) {
        el.innerHTML = '<p>No stock items yet.</p>';
        return;
    }
    const rows = stockCatalog
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(it => `<tr><td>${escapeHtml(it.name)}</td><td>${(parseFloat(it.rate)||0).toFixed(2)}</td><td>${(parseFloat(it.qty)||0).toFixed(2)}</td></tr>`)
        .join('');
    el.innerHTML = `
        <table class="audit-table">
            <thead><tr><th>Item</th><th>Rate</th><th>Qty available</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function setupVehicleMakeAutosuggest() {
    const input = document.getElementById('vehicleMake');
    const listEl = document.getElementById('vehicleMakeSuggestions');
    if (!input || !listEl) return;

    let hideTimeout = null;

    function renderSuggestions() {
        const query = input.value.trim().toLowerCase();
        listEl.innerHTML = '';

        if (!query) {
            listEl.style.display = 'none';
            return;
        }

        const matches = allVehicleTypes
            .filter(v => v.toLowerCase().includes(query))
            .slice(0, 12);

        if (!matches.length) {
            listEl.style.display = 'none';
            return;
        }

        matches.forEach(value => {
            const itemEl = document.createElement('div');
            itemEl.className = 'autosuggest-item';
            itemEl.textContent = value;
            itemEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = value;
                listEl.style.display = 'none';
            });
            listEl.appendChild(itemEl);
        });

        listEl.style.display = 'block';
    }

    input.addEventListener('input', renderSuggestions);
    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('blur', () => {
        hideTimeout = setTimeout(() => {
            listEl.style.display = 'none';
        }, 150);
    });

    listEl.addEventListener('mouseenter', () => {
        if (hideTimeout) clearTimeout(hideTimeout);
    });

    listEl.addEventListener('mouseleave', () => {
        hideTimeout = setTimeout(() => {
            listEl.style.display = 'none';
        }, 150);
    });
}

async function lookupVehicleAndPrefill(vehicleNumber) {
    if (!vehicleNumber || vehicleNumber.length < 4) return;
    try {
        const result = await ipcRenderer.invoke('get-vehicle-by-number', vehicleNumber);
        if (result.success && result.data) {
            const d = result.data;
            if (d.customerName) document.getElementById('customerName').value = d.customerName;
            if (d.customerPhone) document.getElementById('customerPhone').value = d.customerPhone;
            if (d.vehicleMake) document.getElementById('vehicleMake').value = d.vehicleMake;
            showNotification('Customer/vehicle details pre-filled from previous bill (editable)', 'success');
        }
    } catch (e) {
        console.error('Vehicle lookup error:', e);
    }
}

function addItem() {
    const tbody = document.getElementById('itemsBody');
    const itemCount = tbody.querySelectorAll('.item-row').length + 1;

    const row = document.createElement('tr');
    row.className = 'item-row';
    row.innerHTML = `
        <td class="item-number">${itemCount}</td>
        <td><input type="text" class="item-particulars" placeholder="Item/Service description" required></td>
        <td><input type="number" class="item-qty" value="1" min="1" required></td>
        <td><input type="number" class="item-amount" placeholder="0.00" step="0.01" min="0" required></td>
        <td><button type="button" class="remove-btn" onclick="removeItem(this)">Remove</button></td>
    `;

    tbody.appendChild(row);
    updateItemNumbers();
}

function removeItem(button) {
    const tbody = document.getElementById('itemsBody');
    if (tbody.querySelectorAll('.item-row').length > 1) {
        button.closest('.item-row').remove();
        updateItemNumbers();
        calculateTotals();
    } else {
        showNotification('At least one item is required', 'error');
    }
}

function updateItemNumbers() {
    const rows = document.querySelectorAll('.item-row');
    rows.forEach((row, index) => {
        row.querySelector('.item-number').textContent = index + 1;
    });
}

function calculateTotals() {
    const rows = document.querySelectorAll('.item-row');
    let grandTotal = 0;

    // Sum all item amounts (amounts are GST inclusive)
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const amount = parseFloat(row.querySelector('.item-amount').value) || 0;
        // Calculate line total with precision
        const lineTotal = Math.round(qty * amount * 100) / 100;
        grandTotal += lineTotal;
    });

    // Round grand total to 2 decimal places
    grandTotal = Math.round(grandTotal * 100) / 100;

    // Reverse calculate: Total includes 18% GST
    // Formula: Total = Basic + (Basic * 0.18)
    // Therefore: Basic = Total / 1.18
    // Using precise calculation
    const basicAmount = Math.round((grandTotal / 1.18) * 100) / 100;
    const sgst = Math.round((basicAmount * 0.09) * 100) / 100;
    const cgst = Math.round((basicAmount * 0.09) * 100) / 100;

    document.getElementById('grandTotal').value = grandTotal.toFixed(2);
    document.getElementById('basicAmount').value = basicAmount.toFixed(2);
    document.getElementById('sgst').value = sgst.toFixed(2);
    document.getElementById('cgst').value = cgst.toFixed(2);

    // Convert to words (use grand total for words)
    document.getElementById('amountInWords').value = numberToWords(Math.round(grandTotal));
}

function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return 'Zero Rupees Only';

    num = Math.floor(Math.abs(num));

    const crore = Math.floor(num / 10000000);
    num %= 10000000;
    const lakh = Math.floor(num / 100000);
    num %= 100000;
    const thousand = Math.floor(num / 1000);
    num %= 1000;
    const hundred = Math.floor(num / 100);
    num %= 100;
    const ten = Math.floor(num / 10);
    const one = Math.floor(num % 10);

    let words = '';

    if (crore > 0) {
        words += numberToWordsHelper(crore) + ' Crore ';
    }
    if (lakh > 0) {
        words += numberToWordsHelper(lakh) + ' Lakh ';
    }
    if (thousand > 0) {
        words += numberToWordsHelper(thousand) + ' Thousand ';
    }
    if (hundred > 0) {
        words += ones[hundred] + ' Hundred ';
    }
    if (ten > 1) {
        words += tens[ten] + ' ';
        if (one > 0) {
            words += ones[one] + ' ';
        }
    } else if (ten === 1) {
        words += teens[one] + ' ';
    } else if (one > 0) {
        words += ones[one] + ' ';
    }

    words += 'Rupees Only';

    return words.trim();
}

function numberToWordsHelper(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return '';
    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    if (num < 100) {
        const ten = Math.floor(num / 10);
        const one = num % 10;
        return tens[ten] + (one > 0 ? ' ' + ones[one] : '');
    }
    return '';
}

// Constants for pagination
const ITEMS_PER_PAGE_FIRST = 20;  // Items on first page (with header)
const ITEMS_PER_PAGE_CONTINUATION = 25;  // Items on continuation pages (more space without header)

// Function to generate all pages for one copy (Customer or Merchant)
function generateBillCopy(doc, formData, items, copyType, isFirstCopy) {
    const totalItems = items.length;

    // Calculate how many pages needed for this copy
    let remainingItems = totalItems;
    let pageCount = 0;

    if (remainingItems <= ITEMS_PER_PAGE_FIRST) {
        pageCount = 1;
    } else {
        remainingItems -= ITEMS_PER_PAGE_FIRST;
        pageCount = 1 + Math.ceil(remainingItems / ITEMS_PER_PAGE_CONTINUATION);
    }

    let itemIndex = 0;

    for (let pageNum = 0; pageNum < pageCount; pageNum++) {
        // Add new page (except for very first page of document)
        if (pageNum > 0 || !isFirstCopy) {
            doc.addPage();
        }

        const isFirstPage = (pageNum === 0);
        const isLastPage = (pageNum === pageCount - 1);

        // Determine items for this page
        const itemsPerThisPage = isFirstPage ? ITEMS_PER_PAGE_FIRST : ITEMS_PER_PAGE_CONTINUATION;
        const pageItems = items.slice(itemIndex, itemIndex + itemsPerThisPage);
        itemIndex += pageItems.length;

        // Generate the page
        generateSinglePage(doc, formData, pageItems, copyType, isFirstPage, isLastPage, pageNum + 1, pageCount);
    }
}

// Split long particulars text into lines that fit within maxWidth (no truncation)
function getWrappedLines(doc, text, maxWidth) {
    if (!text || !String(text).trim()) return [''];
    const str = String(text).trim();
    const words = str.split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const width = doc.getTextWidth(testLine);

        if (width <= maxWidth) {
            currentLine = testLine;
        } else {
            if (currentLine) lines.push(currentLine);
            // If single word is longer than maxWidth, split by character
            if (doc.getTextWidth(word) > maxWidth) {
                let w = '';
                for (const c of word) {
                    if (doc.getTextWidth(w + c) <= maxWidth) {
                        w += c;
                    } else {
                        if (w) lines.push(w);
                        w = c;
                    }
                }
                currentLine = w;
            } else {
                currentLine = word;
            }
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length ? lines : [''];
}

// Function to generate a single page of the bill
function generateSinglePage(doc, formData, items, copyType, isFirstPage, isLastPage, currentPage, totalPages) {
    const green = [46, 204, 113];
    const darkGreen = [39, 174, 96];
    const lightGrey = [245, 245, 245];
    const grey = [200, 200, 200];

    // Add watermark logo if available
    if (logoBase64) {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.08 }));
        doc.addImage(logoBase64, 'PNG', 50, 100, 110, 110);
        doc.restoreGraphicsState();
    }

    let itemTableStartY;

    if (isFirstPage) {
        // Full Header - Company Info (only on first page)
        doc.setFillColor(...green);
        doc.rect(10, 10, 190, 48, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.text('GSTIN: 29CGBPM0738G1ZF', 15, 17);

        // Bill Type (dynamic)
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(formData.billType, 105, 17, { align: 'center' });

        // Copy Type Label (Customer Copy / Merchant Copy)
        doc.setFontSize(8);
        doc.setFont(undefined, 'italic');
        doc.text(`[ ${copyType} ]`, 105, 23, { align: 'center' });

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text('Mob: 94488 07237, 77957 40356', 175, 17, { align: 'right' });

        doc.setFontSize(20);
        doc.setFont(undefined, 'bold');
        doc.text('FIX PLUS AUTO CARE CENTER', 105, 33, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text('Experts in Mahindra, Maruti, Tata & New-Gen Cars | Genuine Spare Parts | Trusted Quality Service', 105, 41, { align: 'center' });
        doc.setFontSize(9);
        doc.text('C-8, SRI MAHADESHWARA COLLEGE ROAD, KOLLEGALA-571440', 105, 47, { align: 'center' });

        // Bill Number and Date row
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`Bill No: ${formData.billNumber}`, 15, 65);
        doc.text(`Date: ${formatDate(formData.billDate)}`, 165, 65);

        // Customer & Vehicle Details - 2x2 Table with grey background
        const tableY = 70;
        // Calculate table height: base 22 + 8 for optional row (GSTIN or Odometer)
        const hasOptionalRow = formData.customerGstin || formData.odometerReading;
        const tableHeight = hasOptionalRow ? 30 : 22;

        // Draw table background (light grey)
        doc.setFillColor(...lightGrey);
        doc.rect(10, tableY, 190, tableHeight, 'F');

        // Draw table borders
        doc.setDrawColor(...grey);
        doc.setLineWidth(0.3);
        doc.rect(10, tableY, 190, tableHeight);
        doc.line(105, tableY, 105, tableY + tableHeight);
        doc.line(10, tableY + 11, 200, tableY + 11);
        if (hasOptionalRow) {
            doc.line(10, tableY + 22, 200, tableY + 22);
        }

        // Table content
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);

        // Row 1, Col 1 - Customer Name
        doc.setFont(undefined, 'normal');
        doc.text('Customer:', 13, tableY + 7);
        doc.setFont(undefined, 'bold');
        doc.text(formData.customerName, 38, tableY + 7);

        // Row 1, Col 2 - Phone
        doc.setFont(undefined, 'normal');
        doc.text('Phone:', 108, tableY + 7);
        doc.setFont(undefined, 'bold');
        doc.text(formData.customerPhone, 125, tableY + 7);

        // Row 2, Col 1 - Vehicle Make
        doc.setFont(undefined, 'normal');
        doc.text('Vehicle:', 13, tableY + 18);
        doc.setFont(undefined, 'bold');
        doc.text(formData.vehicleMake, 35, tableY + 18);

        // Row 2, Col 2 - Vehicle Number (BOLD & LARGER)
        doc.setFont(undefined, 'normal');
        doc.text('Reg. No:', 108, tableY + 18);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.text(formData.vehicleNumber, 130, tableY + 18);
        doc.setFontSize(9);

        // Row 3 - Optional fields: Customer GSTIN (left) | Odometer (right)
        if (formData.customerGstin) {
            doc.setFont(undefined, 'normal');
            doc.text('Customer GSTIN:', 13, tableY + 28);
            doc.setFont(undefined, 'bold');
            doc.text(formData.customerGstin, 55, tableY + 28);
        }
        if (formData.odometerReading) {
            doc.setFont(undefined, 'normal');
            if (formData.customerGstin) {
                // Show on right side if GSTIN is also present
                doc.text('Odometer:', 108, tableY + 28);
                doc.setFont(undefined, 'bold');
                doc.text(formData.odometerReading + ' km', 135, tableY + 28);
            } else {
                // Show on left side if GSTIN is not present
                doc.text('Odometer:', 13, tableY + 28);
                doc.setFont(undefined, 'bold');
                doc.text(formData.odometerReading + ' km', 42, tableY + 28);
            }
        }

        // Items table starts after customer details
        itemTableStartY = tableY + tableHeight + 5;
    } else {
        // Continuation page - Simple header
        doc.setFillColor(...green);
        doc.rect(10, 10, 190, 20, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('FIX PLUS AUTO CARE CENTER', 105, 18, { align: 'center' });

        doc.setFontSize(8);
        doc.setFont(undefined, 'italic');
        doc.text(`[ ${copyType} - Page ${currentPage} of ${totalPages} ]`, 105, 26, { align: 'center' });

        // Bill info on continuation page
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(`Bill No: ${formData.billNumber}`, 15, 38);
        doc.text(`Vehicle: ${formData.vehicleNumber}`, 105, 38);
        doc.text(`Date: ${formatDate(formData.billDate)}`, 165, 38);

        // Items table starts earlier on continuation pages
        itemTableStartY = 45;
    }

    // Items table header
    doc.setFillColor(...green);
    doc.rect(10, itemTableStartY, 190, 9, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text('No.', 15, itemTableStartY + 6);
    doc.text('Particulars', 28, itemTableStartY + 6);
    doc.text('Qty', 150, itemTableStartY + 6);
    doc.text('Amount', 175, itemTableStartY + 6);

    // Table rows
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    let currentY = itemTableStartY + 9;

    const PARTICULARS_MAX_WIDTH = 118;  // from x=28 to Qty at 150
    const LINE_HEIGHT = 4.5;

    items.forEach((item, index) => {
        const particularsText = (item.particulars || '').toString();
        const lines = getWrappedLines(doc, particularsText, PARTICULARS_MAX_WIDTH);
        const rowHeight = Math.max(8, lines.length * LINE_HEIGHT);

        // Alternate row background (full row height)
        if (index % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(10, currentY, 190, rowHeight, 'F');
        }

        doc.setFontSize(9);
        doc.text(item.no.toString(), 17, currentY + 6);

        // Draw particulars with wrap (no truncation)
        doc.setFontSize(9);
        lines.forEach((line, lineIndex) => {
            doc.text(line, 28, currentY + 6 + lineIndex * LINE_HEIGHT);
        });

        doc.text(item.qty.toString(), 152, currentY + 6);
        doc.text(parseFloat(item.amount).toFixed(2), 175, currentY + 6);

        // Draw line
        doc.setDrawColor(...grey);
        doc.setLineWidth(0.1);
        doc.line(10, currentY + rowHeight, 200, currentY + rowHeight);

        currentY += rowHeight;
    });

    // Only show totals and signature on the last page
    if (isLastPage) {
        // Totals section
        const totalsY = currentY + 8;

        // Draw box for totals (border only, no background)
        doc.setDrawColor(...green);
        doc.setLineWidth(0.5);
        doc.rect(120, totalsY - 2, 75, 38);

        doc.setFont(undefined, 'bold');
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);

        doc.text('Basic:', 125, totalsY + 5);
        doc.text(formData.basicAmount, 190, totalsY + 5, { align: 'right' });

        doc.text('SGST 9%:', 125, totalsY + 12);
        doc.text(formData.sgst, 190, totalsY + 12, { align: 'right' });

        doc.text('CGST 9%:', 125, totalsY + 19);
        doc.text(formData.cgst, 190, totalsY + 19, { align: 'right' });

        // Draw line before total
        doc.setDrawColor(...darkGreen);
        doc.setLineWidth(0.8);
        doc.line(122, totalsY + 23, 193, totalsY + 23);

        doc.setFontSize(11);
        doc.setTextColor(...darkGreen);
        doc.text('Total:', 125, totalsY + 31);
        doc.text(formData.grandTotal, 190, totalsY + 31, { align: 'right' });

        // Amount in words
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Received Rupees: ${formData.amountInWords}`, 15, totalsY + 42);

        // Signature
        doc.setFont(undefined, 'bold');
        doc.setFontSize(8);
        doc.text('For FIX PLUS AUTO CARE CENTER', 148, totalsY + 50);
        doc.setFont(undefined, 'normal');
        doc.line(148, totalsY + 62, 195, totalsY + 62);
        doc.text('Authorized Signature', 158, totalsY + 67);
    } else {
        // Show "Continued on next page" message
        doc.setFontSize(9);
        doc.setFont(undefined, 'italic');
        doc.setTextColor(100, 100, 100);
        doc.text('... Continued on next page', 105, currentY + 15, { align: 'center' });
    }

    // Marketing Footer (on all pages)
    doc.setFillColor(...green);
    doc.rect(10, 270, 190, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Thank You! Visit Again for Exciting Offers & Discounts!', 105, 277, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text('Quality Service | Transparent Pricing | Customer Satisfaction Guaranteed', 105, 283, { align: 'center' });

    // Eco-friendly slogan
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    doc.text('Responsible Auto Care for a Greener Planet | Protection of Nature & Wildlife is Essential', 105, 289, { align: 'center' });
}

async function generatePDF(e) {
    e.preventDefault();

    // Validate phone number
    const phone = document.getElementById('customerPhone').value;
    if (phone.length !== 10) {
        showNotification('Please enter a valid 10-digit phone number', 'error');
        return;
    }

    try {
        // Get form data
        const formData = {
            billType: document.getElementById('billType').value,
            billNumber: document.getElementById('billNumber').value,
            billDate: document.getElementById('billDate').value,
            customerName: document.getElementById('customerName').value,
            customerPhone: document.getElementById('customerPhone').value,
            customerGstin: document.getElementById('customerGstin').value.trim(),
            vehicleMake: document.getElementById('vehicleMake').value,
            vehicleNumber: formatVehicleNumber(document.getElementById('vehicleNumber').value),
            odometerReading: document.getElementById('odometerReading').value.trim(),
            paymentMode: document.getElementById('paymentMode').value,
            technicianName: (document.getElementById('technicianName').value || '').trim(),
            technicianDaySalary: (document.getElementById('technicianDaySalary').value || '').trim(),
            basicAmount: document.getElementById('basicAmount').value,
            sgst: document.getElementById('sgst').value,
            cgst: document.getElementById('cgst').value,
            grandTotal: document.getElementById('grandTotal').value,
            amountInWords: document.getElementById('amountInWords').value
        };

        // Get items
        const items = [];
        const rows = document.querySelectorAll('.item-row');
        rows.forEach((row, index) => {
            const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
            const amount = parseFloat(row.querySelector('.item-amount').value) || 0;
            items.push({
                no: index + 1,
                particulars: row.querySelector('.item-particulars').value,
                qty: qty.toString(),
                amount: (qty * amount).toFixed(2)
            });
        });

        // Generate PDF with multiple pages (Customer Copy + Merchant Copy)
        // Handles pagination automatically if items exceed 20 per page
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Load Kannada font if available
        if (kannadaFontLoaded) {
            try {
                const fontPath = path.join(__dirname, 'NotoSansKannada-Regular.ttf');
                const fontData = fs.readFileSync(fontPath);
                const fontBase64 = fontData.toString('base64');

                doc.addFileToVFS('NotoSansKannada-Regular.ttf', fontBase64);
                doc.addFont('NotoSansKannada-Regular.ttf', 'NotoSansKannada', 'normal');
                console.log('Kannada font registered with PDF');
            } catch (err) {
                console.error('Error registering Kannada font:', err);
            }
        }

        // Customer Copy (may span multiple pages if many items)
        generateBillCopy(doc, formData, items, 'CUSTOMER COPY', true);

        // Merchant Copy (may span multiple pages if many items)
        generateBillCopy(doc, formData, items, 'MERCHANT COPY', false);

        // Save PDF
        const pdfData = doc.output('datauristring');
        const vehicleNoClean = formData.vehicleNumber.replace(/[^a-zA-Z0-9]/g, '');
        const dateForFile = formatDate(formData.billDate).replace(/\//g, '-');
        const computedFileName = `${formData.billNumber}_${vehicleNoClean}_${dateForFile}.pdf`;
        const fileName = (editBillContext && editBillContext.originalFileName) ? editBillContext.originalFileName : computedFileName;

        const result = await ipcRenderer.invoke('save-pdf', { pdfData, fileName });

        if (result.success) {
            showNotification(`PDF saved: ${fileName}`);

            // Store bill record for auditing (day-wise & month-wise JSON)
            const record = {
                billType: formData.billType,
                billNumber: formData.billNumber,
                billDate: formData.billDate,
                customerName: formData.customerName,
                customerPhone: formData.customerPhone,
                customerGstin: formData.customerGstin,
                vehicleMake: formData.vehicleMake,
                vehicleNumber: formData.vehicleNumber,
                odometerReading: formData.odometerReading,
                paymentMode: formData.paymentMode,
                technicianName: formData.technicianName,
                technicianDaySalary: formData.technicianDaySalary,
                basicAmount: formData.basicAmount,
                sgst: formData.sgst,
                cgst: formData.cgst,
                grandTotal: formData.grandTotal,
                amountInWords: formData.amountInWords,
                items: items,
                fileName: fileName
            };
            const saveRecordResult = editBillContext
                ? await ipcRenderer.invoke('update-bill-record', {
                    originalBillDate: editBillContext.originalBillDate,
                    originalBillNumber: editBillContext.originalBillNumber,
                    updatedRecord: record
                })
                : await ipcRenderer.invoke('save-bill-record', record);
            if (!saveRecordResult.success) {
                console.error('Failed to save bill record for audit:', saveRecordResult.error);
            }

            // Store bill data for WhatsApp sharing
            lastBillData = {
                ...formData,
                items: items,
                fileName: fileName,
                filePath: result.filePath
            };

            // Enable WhatsApp button
            document.getElementById('sendWhatsApp').disabled = false;

            // Update bill number in config (skip when editing existing bill)
            if (!editBillContext) {
                const currentBillNum = parseInt(formData.billNumber);
                await ipcRenderer.invoke('save-bill-number', currentBillNum);
            }

            // Open the PDF file automatically
            setTimeout(async () => {
                await ipcRenderer.invoke('open-pdf-file', result.filePath);
            }, 500);

            // NOTE: Form is NOT auto-cleared so user can access WhatsApp button
            // User should click "Clear Form" manually after sending WhatsApp
            // Just show a reminder notification
            setTimeout(() => {
                showNotification('Bill saved! Use WhatsApp button or Clear Form for next bill', 'success');
            }, 1500);

            // Exit edit mode after successful overwrite/update
            if (editBillContext) {
                editBillContext = null;
                document.getElementById('cancelEditMode').style.display = 'none';
                document.getElementById('billNumber').disabled = false;
                document.getElementById('billDate').disabled = false;
                document.getElementById('vehicleNumber').disabled = false;
            }
        } else {
            showNotification('Error saving PDF: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error generating PDF:', error);
        showNotification('Error generating PDF: ' + error.message, 'error');
    }
}

// WhatsApp Functions
function showWhatsAppModal() {
    if (!lastBillData) {
        showNotification('Please generate a bill first', 'error');
        return;
    }

    const modal = document.getElementById('whatsappModal');
    const modalText = document.getElementById('whatsappModalText');

    modalText.innerHTML = `
        Send bill details to <strong>${lastBillData.customerName}</strong><br>
        Phone: <strong>+91 ${lastBillData.customerPhone}</strong><br>
        Vehicle: <strong>${lastBillData.vehicleNumber}</strong><br>
        Amount: <strong>Rs. ${lastBillData.grandTotal}</strong>
    `;

    modal.classList.add('show');
}

function hideWhatsAppModal() {
    document.getElementById('whatsappModal').classList.remove('show');
}

function sendWhatsApp() {
    if (!lastBillData) {
        showNotification('No bill data available', 'error');
        return;
    }

    // Create WhatsApp message
    const message = createWhatsAppMessage(lastBillData);

    // Format phone number for WhatsApp (add country code if not present)
    let phoneNumber = lastBillData.customerPhone;
    if (!phoneNumber.startsWith('91')) {
        phoneNumber = '91' + phoneNumber;
    }

    // Create WhatsApp URL
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;

    // Open WhatsApp in default browser
    shell.openExternal(whatsappUrl);

    hideWhatsAppModal();
    showNotification('Opening WhatsApp...');
}

function createWhatsAppMessage(billData) {
    let itemsList = '';
    billData.items.forEach((item, index) => {
        itemsList += `${index + 1}. ${item.particulars} - Rs.${item.amount}\n`;
    });

    const message = `*FIX PLUS AUTO CARE CENTER*
_Experts in Mahindra, Maruti, Tata & New-Gen Cars_
C-8, Sri Mahadeshwara College Road, Kollegala-571440
Ph: 94488 07237, 77957 40356

━━━━━━━━━━━━━━━━━━━━
*${billData.billType}*
━━━━━━━━━━━━━━━━━━━━

*Bill No:* ${billData.billNumber}
*Date:* ${formatDate(billData.billDate)}

*Customer:* ${billData.customerName}
*Vehicle:* ${billData.vehicleMake}
*Reg. No:* ${billData.vehicleNumber}

━━━━━━━━━━━━━━━━━━━━
*ITEMS/SERVICES:*
━━━━━━━━━━━━━━━━━━━━
${itemsList}
━━━━━━━━━━━━━━━━━━━━
*Basic:* Rs.${billData.basicAmount}
*SGST 9%:* Rs.${billData.sgst}
*CGST 9%:* Rs.${billData.cgst}
━━━━━━━━━━━━━━━━━━━━
*TOTAL: Rs.${billData.grandTotal}*
━━━━━━━━━━━━━━━━━━━━

_${billData.amountInWords}_

Thank you for choosing Fix Plus Auto Care Center!
Visit again for exciting offers & discounts!

_GSTIN: 29CGBPM0738G1ZF_`;

    return message;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Format vehicle number: ka19ae2390 -> KA19AE2390
function formatVehicleNumber(vehicleNum) {
    return vehicleNum.toUpperCase().replace(/\s+/g, '');
}

function clearForm() {
    // Don't reset bill type - keep previous selection
    const currentBillType = document.getElementById('billType').value;
    const currentBillNumber = parseInt(document.getElementById('billNumber').value);

    document.getElementById('billingForm').reset();

    // Restore bill type
    document.getElementById('billType').value = currentBillType;

    // If a bill was generated, increment bill number for next bill
    // Otherwise keep the same number (user is just clearing a mistake)
    if (lastBillData) {
        document.getElementById('billNumber').value = currentBillNumber + 1;
    } else {
        document.getElementById('billNumber').value = currentBillNumber;
    }

    // Reset items table
    const tbody = document.getElementById('itemsBody');
    tbody.innerHTML = `
        <tr class="item-row">
            <td class="item-number">1</td>
            <td><input type="text" class="item-particulars" placeholder="Item/Service description" required></td>
            <td><input type="number" class="item-qty" value="1" min="1" required></td>
            <td><input type="number" class="item-amount" placeholder="0.00" step="0.01" min="0" required></td>
            <td><button type="button" class="remove-btn" onclick="removeItem(this)">Remove</button></td>
        </tr>
    `;

    // Reset totals
    document.getElementById('grandTotal').value = '';
    document.getElementById('basicAmount').value = '';
    document.getElementById('sgst').value = '';
    document.getElementById('cgst').value = '';
    document.getElementById('amountInWords').value = '';

    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('billDate').value = today;

    // Disable WhatsApp button (no bill generated for new form)
    document.getElementById('sendWhatsApp').disabled = true;

    // Clear last bill data
    lastBillData = null;
}

async function openBillsFolder() {
    const result = await ipcRenderer.invoke('open-bills-folder');
    if (!result.success) {
        showNotification('Error opening folder: ' + result.error, 'error');
    }
}

// ----- Audit & Reports -----
let currentAuditMonth = null;

function showAuditPanel() {
    document.getElementById('auditPanel').classList.add('show');
    loadAuditMonthsList();
}

function hideAuditPanel() {
    document.getElementById('auditPanel').classList.remove('show');
}

async function loadAuditMonthsList() {
    const result = await ipcRenderer.invoke('get-available-months');
    const sel = document.getElementById('auditMonthSelect');
    sel.innerHTML = '<option value="">-- Select month --</option>';
    if (result.success && result.months && result.months.length) {
        result.months.forEach(ym => {
            const [y, m] = ym.split('-');
            const label = `${monthName(parseInt(m, 10))} ${y}`;
            sel.appendChild(new Option(label, ym));
        });
        sel.dispatchEvent(new Event('change'));
    }
}

function monthName(m) {
    const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[m] || '';
}

async function loadAuditMonth() {
    const YYYYMM = document.getElementById('auditMonthSelect').value;
    currentAuditMonth = YYYYMM;
    currentAuditMonthData = null;
    if (!YYYYMM) {
        document.getElementById('auditSummary').innerHTML = '';
        document.getElementById('auditDayTableBody').innerHTML = '';
        document.getElementById('auditDayExpenses').innerHTML = '';
        document.getElementById('editBillDaySelect').innerHTML = '<option value="">-- Select day --</option>';
        document.getElementById('editBillSelect').innerHTML = '<option value="">-- Select bill --</option>';
        return;
    }
    const result = await ipcRenderer.invoke('get-month-records', YYYYMM);
    if (!result.success || !result.data) {
        document.getElementById('auditSummary').innerHTML = '<p>No records for this month.</p>';
        document.getElementById('auditDayTableBody').innerHTML = '';
        document.getElementById('auditDayExpenses').innerHTML = '';
        document.getElementById('editBillDaySelect').innerHTML = '<option value="">-- Select day --</option>';
        document.getElementById('editBillSelect').innerHTML = '<option value="">-- Select bill --</option>';
        return;
    }
    const data = result.data;
    currentAuditMonthData = data;
    const [year, month] = YYYYMM.split('-');
    const totalBilling = data.monthTotalBilling || 0;
    const basicAmount = data.monthBasicAmount || 0;
    const sgst = data.monthSGST || 0;
    const cgst = data.monthCGST || 0;
    const labor = data.monthLaborPaid || 0;
    const other = data.monthOtherExpenditure || 0;
    const cash = data.monthCashCollected || 0;
    const upi = data.monthUpiCollected || 0;
    const card = data.monthCardCollected || 0;
    const techPayout = data.monthTechnicianPayout || 0;

    document.getElementById('auditSummary').innerHTML = `
        <h4>${monthName(parseInt(month, 10))} ${year} – Summary</h4>
        <div class="audit-summary-grid">
            <div class="audit-summary-item"><span>Total Billing (incl. GST):</span> <strong>₹ ${totalBilling.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>Without Tax (Basic):</span> <strong>₹ ${basicAmount.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>SGST Collected:</span> <strong>₹ ${sgst.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>CGST Collected:</span> <strong>₹ ${cgst.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>Total Labor Paid:</span> <strong>₹ ${labor.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>Other Expenditure:</span> <strong>₹ ${other.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>Cash Collected:</span> <strong>₹ ${cash.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>UPI Collected:</span> <strong>₹ ${upi.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>Card Collected:</span> <strong>₹ ${card.toFixed(2)}</strong></div>
            <div class="audit-summary-item"><span>Technician Payout (daily):</span> <strong>₹ ${techPayout.toFixed(2)}</strong></div>
        </div>
    `;

    const dayKeys = Object.keys(data.days || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    let tableHtml = '';
    let expensesHtml = '<h4>Day-wise labor & expenditure (editable)</h4><div class="day-expenses-list">';
    dayKeys.forEach(day => {
        const d = data.days[day];
        const dateStr = `${day}/${month}/${year}`;
        tableHtml += `
            <tr>
                <td>${dateStr}</td>
                <td>${(d.totalBilling || 0).toFixed(2)}</td>
                <td>${(d.basicAmount || 0).toFixed(2)}</td>
                <td>${(d.sgstCollected || 0).toFixed(2)}</td>
                <td>${(d.cgstCollected || 0).toFixed(2)}</td>
                <td>${(d.laborPaid || 0).toFixed(2)}</td>
                <td>${(d.otherExpenditure || 0).toFixed(2)}</td>
            </tr>
        `;
        expensesHtml += `
            <div class="day-expense-row" data-day="${day}">
                <label>${dateStr}</label>
                <input type="number" step="0.01" min="0" placeholder="Labor" value="${d.laborPaid || ''}" class="day-labor">
                <input type="number" step="0.01" min="0" placeholder="Other" value="${d.otherExpenditure || ''}" class="day-other">
            </div>
        `;
    });
    expensesHtml += '</div><button type="button" id="saveDayExpenses" class="add-btn">Save day-wise labor & expenditure</button>';
    document.getElementById('auditDayTableBody').innerHTML = tableHtml;
    document.getElementById('auditDayExpenses').innerHTML = expensesHtml;
    const saveBtn = document.getElementById('saveDayExpenses');
    if (saveBtn) saveBtn.addEventListener('click', saveDayExpenses);

    // Populate edit dropdowns (day list first)
    const daySel = document.getElementById('editBillDaySelect');
    daySel.innerHTML = '<option value="">-- Select day --</option>';
    dayKeys.forEach(d => {
        daySel.appendChild(new Option(`${d}/${month}/${year}`, d));
    });
    document.getElementById('editBillSelect').innerHTML = '<option value="">-- Select bill --</option>';
}

async function saveDayExpenses() {
    if (!currentAuditMonth) return;
    const YYYYMM = currentAuditMonth;
    const rows = document.querySelectorAll('.day-expense-row');
    for (const row of rows) {
        const day = row.getAttribute('data-day');
        const labor = row.querySelector('.day-labor').value;
        const other = row.querySelector('.day-other').value;
        await ipcRenderer.invoke('update-day-expenses', { YYYYMM, day, laborPaid: labor || 0, otherExpenditure: other || 0 });
    }
    showNotification('Day-wise labor & expenditure saved.');
    loadAuditMonth(); // refresh
}

async function generateAuditPdf() {
    if (!currentAuditMonth) {
        showNotification('Please select a month first', 'error');
        return;
    }
    const result = await ipcRenderer.invoke('get-month-records', currentAuditMonth);
    if (!result.success || !result.data) {
        showNotification('No records for this month', 'error');
        return;
    }
    const data = result.data;
    const [year, month] = currentAuditMonth.split('-');
    const monthLabel = `${monthName(parseInt(month, 10))} ${year}`;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const green = [46, 204, 113];
    const grey = [200, 200, 200];

    doc.setFillColor(...green);
    doc.rect(10, 10, 190, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('FIX PLUS AUTO CARE CENTER', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text('Month-wise Bill Collection – Audit Record', 105, 28, { align: 'center' });

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Month: ${monthLabel}`, 15, 42);
    doc.text(`Generated: ${formatDate(new Date().toISOString().split('T')[0])}`, 150, 42);

    // Summary
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text('Summary', 15, 52);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(`Total Billing (incl. GST): Rs. ${(data.monthTotalBilling || 0).toFixed(2)}`, 15, 60);
    doc.text(`Without Tax (Basic):       Rs. ${(data.monthBasicAmount || 0).toFixed(2)}`, 15, 66);
    doc.text(`SGST Collected:            Rs. ${(data.monthSGST || 0).toFixed(2)}`, 15, 72);
    doc.text(`CGST Collected:            Rs. ${(data.monthCGST || 0).toFixed(2)}`, 15, 78);
    doc.text(`Labor Paid:                Rs. ${(data.monthLaborPaid || 0).toFixed(2)}`, 15, 84);
    doc.text(`Other Expenditure:         Rs. ${(data.monthOtherExpenditure || 0).toFixed(2)}`, 15, 90);

    // Day-wise table
    let y = 100;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.setFillColor(...green);
    doc.rect(10, y - 5, 190, 8, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.text('Date', 15, y + 1);
    doc.text('Total', 45, y + 1);
    doc.text('Basic', 70, y + 1);
    doc.text('SGST', 95, y + 1);
    doc.text('CGST', 120, y + 1);
    doc.text('Labor', 145, y + 1);
    doc.text('Other', 170, y + 1);
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    y += 10;

    const dayKeys = Object.keys(data.days || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    dayKeys.forEach(day => {
        const d = data.days[day];
        const dateStr = `${day}/${month}/${year}`;
        doc.setFontSize(9);
        doc.text(dateStr, 15, y);
        doc.text((d.totalBilling || 0).toFixed(2), 45, y);
        doc.text((d.basicAmount || 0).toFixed(2), 70, y);
        doc.text((d.sgstCollected || 0).toFixed(2), 95, y);
        doc.text((d.cgstCollected || 0).toFixed(2), 120, y);
        doc.text((d.laborPaid || 0).toFixed(2), 145, y);
        doc.text((d.otherExpenditure || 0).toFixed(2), 170, y);
        doc.setDrawColor(...grey);
        doc.line(10, y + 2, 200, y + 2);
        y += 7;
    });

    // Bill list (condensed)
    y += 8;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('Bill-wise collection', 15, y);
    doc.setFont(undefined, 'normal');
    y += 8;
    doc.setFontSize(8);
    dayKeys.forEach(day => {
        const d = data.days[day];
        (d.bills || []).forEach(b => {
            doc.text(`${b.billDate}  Bill#${b.billNumber}  ${(b.vehicleNumber || '')}  Rs.${(parseFloat(b.grandTotal) || 0).toFixed(2)}`, 15, y);
            y += 5;
            if (y > 270) { doc.addPage(); y = 20; }
        });
    });

    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('For FIX PLUS AUTO CARE CENTER – Audit / Internal Use', 105, 285, { align: 'center' });

    const pdfData = doc.output('datauristring');
    const fileName = `Audit_${currentAuditMonth}_FixPlus.pdf`;
    const saveResult = await ipcRenderer.invoke('save-pdf', { pdfData, fileName });
    if (saveResult.success) {
        showNotification(`Audit PDF saved: ${fileName}`);
        setTimeout(() => ipcRenderer.invoke('open-pdf-file', saveResult.filePath), 500);
    } else {
        showNotification('Error saving audit PDF: ' + saveResult.error, 'error');
    }
}

async function exportMonthCsv() {
    if (!currentAuditMonth) {
        showNotification('Please select a month first', 'error');
        return;
    }
    const result = await ipcRenderer.invoke('export-month-csv', { YYYYMM: currentAuditMonth });
    if (!result.success) {
        showNotification('Export failed: ' + (result.error || ''), 'error');
        return;
    }
    showNotification(`Exported: ${result.fileName}`);
    if (result.filePath) {
        setTimeout(() => ipcRenderer.invoke('open-pdf-file', result.filePath), 300);
    }
}

async function backupAndClear() {
    const ok = window.confirm('This will create a backup ZIP and then CLEAR all bills (billing_records + generated PDFs). Continue?');
    if (!ok) return;
    const result = await ipcRenderer.invoke('backup-and-clear-bills');
    if (!result.success) {
        showNotification('Backup failed: ' + (result.error || ''), 'error');
        return;
    }
    showNotification(`Backup created: ${result.fileName}. Bills cleared.`);
    // refresh audit UI
    currentAuditMonth = null;
    currentAuditMonthData = null;
    await loadAuditMonthsList();
    await loadStockCatalog();
}

function refreshEditBillList() {
    const billSel = document.getElementById('editBillSelect');
    billSel.innerHTML = '<option value="">-- Select bill --</option>';

    if (!currentAuditMonthData) return;
    const day = document.getElementById('editBillDaySelect').value;
    if (!day) return;

    const dayData = (currentAuditMonthData.days || {})[day];
    const bills = (dayData && dayData.bills) ? dayData.bills : [];

    // Show latest first within day
    const sorted = [...bills].sort((a, b) => (parseInt(b.billNumber, 10) || 0) - (parseInt(a.billNumber, 10) || 0));
    sorted.forEach(b => {
        const label = `Bill #${b.billNumber} • ${b.vehicleNumber || ''} • Rs.${(parseFloat(b.grandTotal) || 0).toFixed(2)}`;
        billSel.appendChild(new Option(label, String(b.billNumber)));
    });
}

function cancelEditMode() {
    editBillContext = null;
    document.getElementById('cancelEditMode').style.display = 'none';
    document.getElementById('billNumber').disabled = false;
    document.getElementById('billDate').disabled = false;
    document.getElementById('vehicleNumber').disabled = false;
    showNotification('Edit mode cancelled.');
}

function loadSelectedBillForEdit() {
    if (!currentAuditMonth || !currentAuditMonthData) {
        showNotification('Please select a month first', 'error');
        return;
    }
    const day = document.getElementById('editBillDaySelect').value;
    const billNumber = document.getElementById('editBillSelect').value;
    if (!day || !billNumber) {
        showNotification('Please select day and bill', 'error');
        return;
    }
    const dayData = (currentAuditMonthData.days || {})[day];
    const bills = (dayData && dayData.bills) ? dayData.bills : [];
    const bill = bills.find(b => String(b.billNumber) === String(billNumber));
    if (!bill) {
        showNotification('Bill not found', 'error');
        return;
    }

    // Fill the form
    document.getElementById('billType').value = bill.billType || 'CASH BILL';
    document.getElementById('billNumber').value = bill.billNumber || '';
    document.getElementById('billDate').value = bill.billDate || '';
    document.getElementById('customerName').value = bill.customerName || '';
    document.getElementById('customerPhone').value = bill.customerPhone || '';
    document.getElementById('customerGstin').value = bill.customerGstin || '';
    document.getElementById('vehicleMake').value = bill.vehicleMake || '';
    document.getElementById('vehicleNumber').value = bill.vehicleNumber || '';
    document.getElementById('odometerReading').value = bill.odometerReading || '';

    // Items table
    const tbody = document.getElementById('itemsBody');
    const items = Array.isArray(bill.items) ? bill.items : [];
    const rowsHtml = (items.length ? items : [{ particulars: '', qty: '1', amount: '0.00' }]).map((it, idx) => {
        // Stored item.amount is line total; we keep qty and amount as "per unit" in UI.
        // If we can't infer unit price, we set unit=lineTotal/qty.
        const qty = parseFloat(it.qty) || 1;
        const lineTotal = parseFloat(it.amount) || 0;
        const unit = qty ? (lineTotal / qty) : lineTotal;
        return `
            <tr class="item-row">
                <td class="item-number">${idx + 1}</td>
                <td><input type="text" class="item-particulars" placeholder="Item/Service description" required value="${escapeHtml(it.particulars || '')}"></td>
                <td><input type="number" class="item-qty" value="${qty}" min="1" required></td>
                <td><input type="number" class="item-amount" placeholder="0.00" step="0.01" min="0" required value="${unit.toFixed(2)}"></td>
                <td><button type="button" class="remove-btn" onclick="removeItem(this)">Remove</button></td>
            </tr>
        `;
    }).join('');
    tbody.innerHTML = rowsHtml;
    updateItemNumbers();
    calculateTotals();

    // Enter edit mode: lock identifiers to keep same bill identity and overwrite same PDF name
    editBillContext = {
        originalBillDate: bill.billDate,
        originalBillNumber: bill.billNumber,
        originalFileName: bill.fileName || null
    };
    document.getElementById('cancelEditMode').style.display = 'inline-block';
    document.getElementById('billNumber').disabled = true;
    document.getElementById('billDate').disabled = true;
    document.getElementById('vehicleNumber').disabled = true;

    hideAuditPanel();
    showNotification(`Loaded Bill #${bill.billNumber} for editing. Now update and click “Generate PDF & Print”.`);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show' + (type === 'error' ? ' error' : '');

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}
