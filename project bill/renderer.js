const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Logo base64 (will be loaded from file)
let logoBase64 = null;

// Store last generated bill data for WhatsApp sharing
let lastBillData = null;

// Initialize bill number on load
window.addEventListener('DOMContentLoaded', async () => {
    // Load logo
    await loadLogo();

    // Get and set next bill number
    const lastBillNumber = await ipcRenderer.invoke('get-next-bill-number');
    document.getElementById('billNumber').value = lastBillNumber + 1;

    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('billDate').value = today;

    // Add event listeners
    setupEventListeners();
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

function setupEventListeners() {
    // Add item button
    document.getElementById('addItem').addEventListener('click', addItem);

    // Form submission
    document.getElementById('billingForm').addEventListener('submit', generatePDF);

    // Clear form
    document.getElementById('clearForm').addEventListener('click', clearForm);

    // Open folder
    document.getElementById('openFolder').addEventListener('click', openBillsFolder);

    // Calculate totals when items change
    document.getElementById('itemsBody').addEventListener('input', calculateTotals);

    // Phone number validation - only allow digits
    document.getElementById('customerPhone').addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '').substring(0, 10);
    });

    // GSTIN validation - uppercase and limit
    document.getElementById('customerGstin').addEventListener('input', function(e) {
        this.value = this.value.toUpperCase().substring(0, 15);
    });

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

        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text('FIX PLUS AUTO CARE CENTER', 105, 33, { align: 'center' });

        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.text('Experts in Mahindra, Maruti, Tata & New-Gen Cars | Genuine Spare Parts | Trusted Quality Service', 105, 40, { align: 'center' });
        doc.text('C-8, SRI MAHADESHWARA COLLEGE ROAD, KOLLEGALA-571440', 105, 46, { align: 'center' });

        // Bill Number and Date row
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`Bill No: ${formData.billNumber}`, 15, 65);
        doc.text(`Date: ${formatDate(formData.billDate)}`, 165, 65);

        // Customer & Vehicle Details - 2x2 Table with grey background
        const tableY = 70;
        const tableHeight = formData.customerGstin ? 30 : 22;

        // Draw table background (light grey)
        doc.setFillColor(...lightGrey);
        doc.rect(10, tableY, 190, tableHeight, 'F');

        // Draw table borders
        doc.setDrawColor(...grey);
        doc.setLineWidth(0.3);
        doc.rect(10, tableY, 190, tableHeight);
        doc.line(105, tableY, 105, tableY + tableHeight);
        doc.line(10, tableY + 11, 200, tableY + 11);
        if (formData.customerGstin) {
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

        // Row 3 - Customer GSTIN (if provided)
        if (formData.customerGstin) {
            doc.setFont(undefined, 'normal');
            doc.text('Customer GSTIN:', 13, tableY + 28);
            doc.setFont(undefined, 'bold');
            doc.text(formData.customerGstin, 55, tableY + 28);
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

    items.forEach((item, index) => {
        // Alternate row background
        if (index % 2 === 0) {
            doc.setFillColor(250, 250, 250);
            doc.rect(10, currentY, 190, 8, 'F');
        }

        doc.setFontSize(9);
        doc.text(item.no.toString(), 17, currentY + 6);

        // Handle long text
        const particularsText = item.particulars;
        if (particularsText.length > 55) {
            doc.setFontSize(8);
            doc.text(particularsText.substring(0, 55) + '...', 28, currentY + 6);
            doc.setFontSize(9);
        } else {
            doc.text(particularsText, 28, currentY + 6);
        }

        doc.text(item.qty.toString(), 152, currentY + 6);
        doc.text(parseFloat(item.amount).toFixed(2), 175, currentY + 6);

        // Draw line
        doc.setDrawColor(...grey);
        doc.setLineWidth(0.1);
        doc.line(10, currentY + 8, 200, currentY + 8);

        currentY += 8;
    });

    // Only show totals and signature on the last page
    if (isLastPage) {
        // Totals section
        const totalsY = currentY + 8;

        // Draw box for totals
        doc.setFillColor(...lightGrey);
        doc.rect(120, totalsY - 2, 75, 38, 'F');
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
    doc.rect(10, 272, 190, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('Thank You! Visit Again for Exciting Offers & Discounts!', 105, 278, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.text('Quality Service | Transparent Pricing | Customer Satisfaction Guaranteed', 105, 283, { align: 'center' });
    doc.setFontSize(6);
    doc.setFont(undefined, 'italic');
    doc.text('Responsible Auto Care for a Greener Planet | ಪ್ರಕೃತಿ ಮತ್ತು ವನ್ಯಜೀವಿಗಳ ರಕ್ಷಣೆ ಅತ್ಯಗತ್ಯ', 105, 288, { align: 'center' });
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
            vehicleNumber: document.getElementById('vehicleNumber').value.toUpperCase(),
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

        // Customer Copy (may span multiple pages if many items)
        generateBillCopy(doc, formData, items, 'CUSTOMER COPY', true);

        // Merchant Copy (may span multiple pages if many items)
        generateBillCopy(doc, formData, items, 'MERCHANT COPY', false);

        // Save PDF
        const pdfData = doc.output('datauristring');
        const vehicleNoClean = formData.vehicleNumber.replace(/[^a-zA-Z0-9]/g, '');
        const dateForFile = formatDate(formData.billDate).replace(/\//g, '-');
        const fileName = `${formData.billNumber}_${vehicleNoClean}_${dateForFile}.pdf`;

        const result = await ipcRenderer.invoke('save-pdf', { pdfData, fileName });

        if (result.success) {
            showNotification(`PDF saved: ${fileName}`);

            // Store bill data for WhatsApp sharing
            lastBillData = {
                ...formData,
                items: items,
                fileName: fileName,
                filePath: result.filePath
            };

            // Enable WhatsApp button
            document.getElementById('sendWhatsApp').disabled = false;

            // Update bill number in config
            const currentBillNum = parseInt(formData.billNumber);
            await ipcRenderer.invoke('save-bill-number', currentBillNum);

            // Open the PDF file automatically
            setTimeout(async () => {
                await ipcRenderer.invoke('open-pdf-file', result.filePath);
            }, 500);

            // Clear form and set next bill number after a delay
            setTimeout(async () => {
                clearForm();
                document.getElementById('billNumber').value = currentBillNum + 1;
            }, 1000);
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

function clearForm() {
    // Don't reset bill type - keep previous selection
    const currentBillType = document.getElementById('billType').value;
    const currentBillNumber = document.getElementById('billNumber').value;

    document.getElementById('billingForm').reset();

    // Restore bill type and bill number
    document.getElementById('billType').value = currentBillType;
    document.getElementById('billNumber').value = currentBillNumber;

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

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show' + (type === 'error' ? ' error' : '');

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}
